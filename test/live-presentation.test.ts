import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayEvent } from '../src/city/types.ts'
import { animationDelta, eventsAfterMarker, roomPictureSettled, roomPictureAccess, roomStatus } from '../src/live-presentation.ts'
import { nestedLayout } from '../src/ground/nested.ts'

const replayEvent = (changeId: string, at: string): ReplayEvent => ({
  actor: 'author', at, change_id: changeId, event_id: Number(changeId),
  kind: 'note', detail: { note_id: Number(changeId), place_id: 1 }, line: changeId, line_cut: false,
})

test('only fresh IDs beyond the opening cursor belong to this view, regardless of client time', () => {
  const events = [
    replayEvent('10', '2026-09-08T00:00:00Z'),
    replayEvent('11', '2026-09-08T00:00:01Z'),
    replayEvent('12', '2020-01-01T00:00:00Z'),
    replayEvent('13', '2030-01-01T00:00:00Z'),
  ]
  assert.deepEqual(eventsAfterMarker(events, 10).map(event => event.change_id), ['11', '12', '13'])
  assert.deepEqual(eventsAfterMarker(events, 13), [])
})

test('known change IDs never apply twice, including duplicate pages and rows covered by the opening cursor', () => {
  const known = replayEvent('10', '2026-09-08T00:00:01Z')
  const duringCensus = replayEvent('11', known.at)
  const delivered = eventsAfterMarker([duringCensus, known, duringCensus], 10)
  assert.deepEqual(delivered, [duringCensus])
  assert.deepEqual(eventsAfterMarker([known, duringCensus], 11), [])
  assert.deepEqual(eventsAfterMarker([replayEvent('invalid', known.at), replayEvent('-1', known.at)], 10), [])
})

test('capture readiness requires the first poll, the room outline merge, and completed picture reads', () => {
  const complete = { ready: true, firstPollMerged: true, needsOutline: true, outline: 'merged' as const,
    pendingReads: 0, pendingOutline: false }
  assert.equal(roomPictureSettled(complete), true)
  for (const change of [{ ready: false }, { firstPollMerged: false }, { outline: 'pending' as const },
    { pendingReads: 1 }, { pendingOutline: true }]) {
    assert.equal(roomPictureSettled({ ...complete, ...change }), false)
  }
  assert.equal(roomPictureSettled({ ...complete, needsOutline: false, outline: 'pending' }), true)
})

test('null, rejected, and hidden outline results settle the retained picture after reads finish', () => {
  for (const reason of ['null response', 'read rejection', 'contents became hidden']) {
    const resolved = { ready: true, firstPollMerged: true, needsOutline: true, outline: 'unmergeable' as const,
      pendingReads: 0, pendingOutline: false }
    assert.equal(roomPictureSettled(resolved), true, reason)
    assert.equal(roomPictureSettled({ ...resolved, pendingReads: 1 }), false, reason)
  }
})

test('a quiet ancestor gives a rendered descendant the same settlement rule as a quiet room', () => {
  const places = [1, 2].map(id => ({ id, name: `room ${id}`, parent_id: id === 1 ? null : 1,
    quiet: id === 1, owner: null, owner_id: null, has_drawing: false }))
  const layout = nestedLayout(places)
  for (const roomId of [1, 2]) {
    const { quiet, needsOutline } = roomPictureAccess(layout, roomId, new Set())
    assert.equal(quiet, true)
    assert.equal(needsOutline, false)
    assert.equal(roomPictureSettled({ ready: quiet, firstPollMerged: true, needsOutline,
      outline: 'pending', pendingReads: 0, pendingOutline: false }), true)
  }
})

test('contents hidden before the outline read do not wait for a read that cannot start', () => {
  const layout = nestedLayout([{ id: 1, name: 'room', parent_id: null, quiet: false }])
  const hidden = roomPictureAccess(layout, 1, new Set([1]))
  assert.deepEqual(hidden, { quiet: false, needsOutline: false })
  assert.equal(roomPictureSettled({ ...hidden, ready: true, firstPollMerged: true,
    outline: 'pending', pendingReads: 0, pendingOutline: false }), true)
  assert.deepEqual(roomPictureAccess(layout, 1, new Set()), { quiet: false, needsOutline: true })
  assert.deepEqual(roomPictureAccess(layout, 2, new Set()), { quiet: false, needsOutline: false })
})

test('a failed live read freezes the picture until a successful read clears the failure', () => {
  const moving = { ready: true, readFailed: false }
  assert.equal(animationDelta(40, moving), 40)
  assert.equal(animationDelta(-1, moving), 0)
  assert.equal(animationDelta(101, moving), 101)
  assert.equal(animationDelta(Number.NaN, moving), 0)
  assert.equal(animationDelta(40, { ...moving, ready: false }), 0)
  assert.equal(animationDelta(40, { ...moving, readFailed: true }), 0)
  assert.equal(animationDelta(40, moving), 40)
})

test('the live picture uses elapsed wall time without a playback rate or frame clamp', () => {
  const ready = { ready: true, readFailed: false }
  for (const elapsed of [16, 40, 250, 1_000, 30_000]) assert.equal(animationDelta(elapsed, ready), elapsed)
  assert.equal(animationDelta(Number.POSITIVE_INFINITY, ready), 0)
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
