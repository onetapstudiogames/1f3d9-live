import assert from 'node:assert/strict'
import test from 'node:test'
import { initialPlayback, playbackCommand, advancePresentation } from '../src/playback.ts'
import { createClock } from '../src/replay/index.ts'

test('opens paused and every playback button has one stable action', () => {
  assert.deepEqual(initialPlayback(), { paused: true, speed: 1, direction: 'forward' })
  const fast = playbackCommand(initialPlayback(), 'fast')
  assert.deepEqual(fast, { paused: false, speed: 60, direction: 'forward' })
  const pause = playbackCommand(fast, 'pause')
  assert.equal(pause.paused, true)
  assert.deepEqual(playbackCommand(pause, 'pause'), pause)
  assert.deepEqual(playbackCommand(pause, 'rewind'), { paused: false, speed: 60, direction: 'backward' })
  assert.deepEqual(playbackCommand(pause, 'normal'), { paused: false, speed: 1, direction: 'forward' })
})

test('forward presentation holds for actions and stops exactly at the next record', () => {
  const clock = createClock('2026-09-07T00:00:00Z', '2026-09-08T00:00:00Z', 60)
  assert.equal(advancePresentation(clock, 100, true, clock.start + 2000), clock)
  assert.equal(advancePresentation(clock, 100, false, clock.start + 2000).time, clock.start + 2000)
  assert.equal(advancePresentation({ ...clock, speed: 1 }, 100, false, clock.start + 2000).time, clock.start + 100)
  assert.equal(advancePresentation(clock, -1, false, null), clock)
})
