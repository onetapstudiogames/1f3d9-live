import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayEvent } from '../src/city/types.ts'
import { animationDelta, eventsAfterMarker, roomPictureSettled, roomStatus } from '../src/live-presentation.ts'

const replayEvent = (changeId: string, at: string): ReplayEvent => ({
  actor: 'author', at, change_id: changeId, event_id: Number(changeId),
  kind: 'note', detail: { note_id: Number(changeId), place_id: 1 }, line: changeId, line_cut: false,
})

test('the server checkpoint retains changes recorded during census pagination, regardless of client time', () => {
  const events = [
    replayEvent('10', '2026-09-08T00:00:00Z'),
    replayEvent('11', '2026-09-08T00:00:01Z'),
    replayEvent('12', '2020-01-01T00:00:00Z'),
    replayEvent('13', '2030-01-01T00:00:00Z'),
  ]
  assert.deepEqual(eventsAfterMarker(events, 10).map(event => event.change_id), ['11', '12', '13'])
  assert.deepEqual(eventsAfterMarker(events, 13), [])
})

test('known change IDs never apply twice, including duplicate pages and changes already in the initial snapshot', () => {
  const known = replayEvent('10', '2026-09-08T00:00:01Z')
  const duringCensus = replayEvent('11', known.at)
  const delivered = eventsAfterMarker([duringCensus, known, duringCensus], 10)
  assert.deepEqual(delivered, [duringCensus])
  assert.deepEqual(eventsAfterMarker([known, duringCensus], 11), [])
  assert.deepEqual(eventsAfterMarker([replayEvent('invalid', known.at), replayEvent('-1', known.at)], 10), [])
})

test('capture readiness requires the first poll, the room outline merge, and completed picture reads', () => {
  const complete = { ready: true, firstPollMerged: true, needsOutline: true, outlineMerged: true,
    pendingReads: 0, pendingOutline: false }
  assert.equal(roomPictureSettled(complete), true)
  for (const change of [{ ready: false }, { firstPollMerged: false }, { outlineMerged: false },
    { pendingReads: 1 }, { pendingOutline: true }]) {
    assert.equal(roomPictureSettled({ ...complete, ...change }), false)
  }
  assert.equal(roomPictureSettled({ ...complete, needsOutline: false, outlineMerged: false }), true)
})

test('clamps valid animation deltas while readiness, pause, and jump are the only gates', () => {
  const moving = { ready: true, paused: false, jumping: false, readFailed: false, presenceLost: false }
  assert.equal(animationDelta(40, moving), 40)
  assert.equal(animationDelta(-1, moving), 0)
  assert.equal(animationDelta(101, moving), 100)
  assert.equal(animationDelta(Number.NaN, moving), 0)
  assert.equal(animationDelta(40, { ...moving, ready: false }), 0)
  assert.equal(animationDelta(40, { ...moving, paused: true }), 0)
  assert.equal(animationDelta(40, { ...moving, jumping: true }), 0)
  assert.equal(animationDelta(40, { ...moving, readFailed: true, presenceLost: true }), 40)
})

test('chooses room status by size, read failure, then quiet priority', () => {
  assert.equal(roomStatus({ tooSmall: false, readFailed: false, quiet: false }), '')
  assert.equal(roomStatus({ tooSmall: false, readFailed: false, quiet: true }),
    'This is a quiet place; its occupants are not shown.')
  assert.equal(roomStatus({ tooSmall: false, readFailed: true, quiet: true }),
    'The public record could not be read. Keeping the last picture and retrying.')
  assert.equal(roomStatus({ tooSmall: true, readFailed: true, quiet: true }),
    'This window is too small to draw the room.')
})
