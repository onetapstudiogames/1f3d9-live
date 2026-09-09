import assert from 'node:assert/strict'
import test from 'node:test'
import { LIVE_CADENCE_MS, liveReturnReason, beginCurrentReturn } from '../src/live-continuity.ts'
import type { ReplayEvent } from '../src/city/types.ts'

test('only returning from a hidden page requests a fresh current head', () => {
  assert.equal(liveReturnReason({ kind: 'visibility', wasHidden: true, hidden: false }), 'visibility')
  assert.equal(liveReturnReason({ kind: 'visibility', wasHidden: false, hidden: true }), null)
  assert.equal(liveReturnReason({ kind: 'visibility', wasHidden: false, hidden: false }), null)
})

test('a render gap longer than one cadence discards missed activity', () => {
  assert.equal(liveReturnReason({ kind: 'frame', lastFrameAt: 100, now: 100 + LIVE_CADENCE_MS + 1 }), 'gap')
  assert.equal(liveReturnReason({ kind: 'frame', lastFrameAt: 100, now: 100 + LIVE_CADENCE_MS }), null)
  assert.equal(liveReturnReason({ kind: 'frame', lastFrameAt: null, now: 40_000 }), null)
  assert.equal(liveReturnReason({ kind: 'frame', lastFrameAt: 100, now: 99 }), null)
  assert.equal(liveReturnReason({ kind: 'frame', lastFrameAt: 100, now: Number.NaN }), null)
})

const queued: ReplayEvent = { change_id: '1', event_id: 1, at: '2026-09-08T12:00:00Z',
  actor: 'writer', kind: 'note', detail: { note_id: 1, place_id: 2 } }

test('a frame gap clears queued visuals and invalidates an older in-flight read', () => {
  const before = { returnReason: null, liveQueue: [queued], pollGeneration: 4, polling: true }
  const next = beginCurrentReturn(before, 'gap', false)
  assert.deepEqual(next.state.liveQueue, [])
  assert.equal(next.state.pollGeneration, 5)
  assert.equal(next.state.polling, false)
  assert.equal(next.readNow, true)
  assert.deepEqual(before.liveQueue, [queued])
})

test('visibility return discards backlog and schedules its head read when visible', () => {
  const before = { returnReason: null, liveQueue: [queued], pollGeneration: 4, polling: false }
  const hidden = beginCurrentReturn(before, 'visibility', true)
  assert.equal(hidden.readNow, false)
  const visible = beginCurrentReturn(hidden.state, 'visibility', false)
  assert.deepEqual(visible.state.liveQueue, [])
  assert.equal(visible.readNow, true)
  assert.equal(visible.state.returnReason, 'visibility')
})
