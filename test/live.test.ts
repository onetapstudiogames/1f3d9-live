import assert from 'node:assert/strict'
import test from 'node:test'
import { liveNoteReferences, liveReadFailed, liveReadSucceeded, newLiveEvents, validContinuation, type LiveReadState } from '../src/live.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import { settleRecordedScene } from './helpers/recorded-scene.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { createThings, reserveLiveThingEvents } from '../src/things.ts'
import { createResidents, prepareLiveResidents } from '../src/replay/simulation.ts'

const row = (changeId: string, at = '2026-01-01T00:00:01Z'): ReplayEvent => ({
  actor: null, at, change_id: changeId, event_id: Number(changeId), kind: 'notice', detail: {},
})

test('live note reads use current map privacy even while replay looks before a room was founded', () => {
  const place = (id: number, parent_id: number | null, quiet = false) =>
    ({ id, parent_id, quiet, name: `room ${id}`, owner: null, owner_id: null, has_drawing: false })
  const layout = nestedLayout([place(1, null), place(2, 1), place(3, 1, true), place(4, 3)])
  const note = (id: number, placeId: number): ReplayEvent => ({ ...row(String(id)), kind: 'note',
    actor: 'writer', detail: { note_id: id, place_id: placeId } })
  const currentNote = note(11, 2)
  // No replay clock or animation-hidden list may suppress a public note read.
  assert.deepEqual(liveNoteReferences([currentNote, note(12, 3), note(13, 4), note(14, 99),
    { ...note(15, 2), detail: { note_id: 0, place_id: 2 } }, row('16')], layout), [{ event: currentNote, index: 0 }])
})

test('live pages stay oldest-first and duplicate retries are ignored', () => {
  const state: LiveReadState = { marker: '10', seen: new Set(['10']), failures: 0, lastReadAt: null }
  assert.deepEqual(newLiveEvents(state, [row('12', '2025-01-01T00:00:00Z'), row('9'), row('11', '2026-01-01T00:00:02Z')]).map(item => item.change_id), ['11', '12'])
  const next = liveReadSucceeded(state, '12', [row('11'), row('12')], 5_000)
  assert.equal(next.marker, '12')
  assert.deepEqual([...next.seen], ['10', '11', '12'])
  assert.deepEqual(newLiveEvents(next, [row('12')]), [])
})

test('poll success resets backoff and failure keeps the committed marker', () => {
  const state: LiveReadState = { marker: '44', seen: new Set(), failures: 0, lastReadAt: null }
  const failed = liveReadFailed(state)
  assert.equal(failed.marker, '44')
  assert.equal(failed.failures, 1)
  assert.equal(failed.retryMs, 30_000)
  const failedAgain = liveReadFailed(failed)
  assert.equal(failedAgain.retryMs, 60_000)
  const recovered = liveReadSucceeded(failedAgain, '45', [row('45')], 9_000)
  assert.equal(recovered.failures, 0)
  assert.equal(recovered.retryMs, 30_000)
  assert.equal(recovered.lastReadAt, 9_000)
  assert.equal(validContinuation('45', '45', true), false)
  assert.equal(validContinuation('45', '45', false), true)
  assert.equal(validContinuation('45', '44', false), false)
})

test('opening now settles recorded things but census has the final word on resident rooms', () => {
  const replay = {
    span: '1h' as const, window_start: '2026-01-01T00:00:00Z', window_end: '2026-01-01T01:00:00Z', checkpoint: '8',
    complete: true, row_ceiling: 10, counts: {}, map: { places: [
      { id: 1, name: 'world', parent_id: null, owner: null, owner_id: null, quiet: false, has_drawing: false },
      { id: 2, name: 'room', parent_id: 1, owner: null, owner_id: null, quiet: false, has_drawing: false },
    ] }, start: { 'resident:1': { place_id: 1 }, 'thing:7': { place_id: 1 } }, timeline: [
      { actor: 'one', at: '2026-01-01T00:10:00Z', change_id: '7', event_id: 7, kind: 'action', detail: { action: 'move', status: 'applied', from_place_id: 1, to_place_id: 2 } },
      { actor: null, at: '2026-01-01T00:11:00Z', change_id: '8', event_id: 8, kind: 'thing_moved', detail: { thing_id: 7, place_id: 2 } },
    ],
  }
  const census = [{ id: 1, handle: 'one', model: '', joined_at: '2025-01-01T00:00:00Z', has_drawing: false, current_place_id: 1, asleep: false }]
  const layout = nestedLayout(replay.map.places, { 1: 2, 2: 2 })
  const now = settleRecordedScene(replay, census, layout)
  assert.equal(now.residents.residents[1]!.placeId, 1)
  assert.equal(now.things.things[7]!.placeId, 2)
  assert.equal(now.residents.pending, false)
  assert.equal(now.things.pending, false)
  assert.equal(now.residents.residents[1]!.bubble, null)
  assert.equal(now.things.things[7]!.effect, null)
})

test('future things reserve known rooms and registrations add an actor before dispatch', () => {
  const replay = {
    span: '1h' as const, window_start: '2026-01-01T00:00:00Z', window_end: '2026-01-01T01:00:00Z', checkpoint: '1',
    complete: true, row_ceiling: 1, counts: {}, start: {}, timeline: [], map: { places: [
      { id: 1, name: 'world', parent_id: null, owner: null, owner_id: null, quiet: false, has_drawing: false },
    ] },
  }
  const layout = nestedLayout(replay.map.places, { 1: 2 })
  const made = { actor: 'new-one', at: '2026-01-01T01:00:01Z', change_id: '2', event_id: 2,
    kind: 'thing_created', detail: { thing_id: 9, place_id: 1, name: 'lamp' } } as ReplayEvent
  const reserved = reserveLiveThingEvents(createThings(replay, layout), [made], layout)
  assert.ok(reserved.reservations[1]?.some(spot => spot.key === 'thing:9'))
  const register = { actor: 'new-one', at: made.at, change_id: '3', event_id: 3, kind: 'register',
    detail: { resident_id: 7, handle: 'new-one' } } as ReplayEvent
  const residents = prepareLiveResidents(createResidents(replay, [], layout), [register])
  assert.equal(residents.actors.get('new-one'), 7)
  assert.equal(residents.residents[7]?.placeId, null)
})
