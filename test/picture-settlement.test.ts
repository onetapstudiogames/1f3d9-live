import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error The capture helper is intentionally plain JavaScript for direct Node execution.
import { waitForStablePicture } from '../scripts/picture-settlement.mjs'

function manualTimers() {
  const scheduled: Array<{ callback: () => void; milliseconds: number; id: number }> = []
  const cancelled: number[] = []
  return {
    scheduled, cancelled,
    schedule: (callback: () => void, milliseconds: number) => {
      const id = scheduled.length + 1
      scheduled.push({ callback, milliseconds, id })
      return id
    },
    cancel: (id: number) => { cancelled.push(id) },
  }
}

test('capture settlement waits for readiness and one stable second', async () => {
  let time = 0; let reads = 0
  const states = [
    { settled: false, picture: { things: 0 } },
    { settled: true, picture: { things: 1 } },
    { settled: true, picture: { things: 2 } },
    { settled: true, picture: { things: 2 } },
  ]
  const result = await waitForStablePicture(async () => states[Math.min(reads++, states.length - 1)], {
    now: () => time, wait: async (milliseconds: number) => { time += milliseconds }, intervalMs: 250,
  })
  assert.deepEqual(result.picture, { things: 2 })
  assert.equal(time, 1_500)
})

test('capture settlement reports a bounded timeout', async () => {
  let time = 0
  await assert.rejects(waitForStablePicture(async () => ({ settled: false, picture: {} }), {
    now: () => time, wait: async (milliseconds: number) => { time += milliseconds }, intervalMs: 100,
    timeoutMs: 250,
  }), /did not settle within 250ms/)
})

test('capture settlement times out when its first sample never returns', async () => {
  const timers = manualTimers()
  const pending = waitForStablePicture(() => new Promise(() => {}), {
    now: () => 0, timeoutMs: 250, schedule: timers.schedule, cancel: timers.cancel,
  })
  await Promise.resolve()
  assert.equal(timers.scheduled[0]?.milliseconds, 250)
  timers.scheduled[0]!.callback()
  await assert.rejects(pending, /did not settle within 250ms/)
  assert.deepEqual(timers.cancelled, [1])
})

test('a later hung sample receives only the remaining deadline', async () => {
  let time = 0; let reads = 0
  const timers = manualTimers()
  const pending = waitForStablePicture(() => {
    reads += 1
    return reads === 1 ? Promise.resolve({ settled: false, picture: {} }) : new Promise(() => {})
  }, {
    now: () => time, timeoutMs: 300, intervalMs: 100,
    wait: async (milliseconds: number) => { time += milliseconds }, schedule: timers.schedule, cancel: timers.cancel,
  })
  for (let turn = 0; turn < 20 && timers.scheduled.length < 2; turn += 1) await Promise.resolve()
  assert.equal(timers.scheduled[1]?.milliseconds, 200)
  timers.scheduled[1]!.callback()
  await assert.rejects(pending, /did not settle within 300ms/)
  assert.deepEqual(timers.cancelled, [1, 2])
})

test('sample rejection clears its deadline timer', async () => {
  const timers = manualTimers()
  await assert.rejects(waitForStablePicture(async () => { throw new Error('sample failed') }, {
    now: () => 0, schedule: timers.schedule, cancel: timers.cancel,
  }), /sample failed/)
  assert.deepEqual(timers.cancelled, [1])
})
