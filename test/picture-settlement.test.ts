import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error The capture helper is intentionally plain JavaScript for direct Node execution.
import { waitForStablePicture } from '../scripts/picture-settlement.mjs'

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
