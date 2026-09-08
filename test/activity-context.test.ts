import assert from 'node:assert/strict'
import test from 'node:test'
import { createHistoricalActivityContext } from '../src/activity-context.ts'
import type { ActivityContext } from '../src/activity.ts'
import type { ReplayFile, Resident } from '../src/city/types.ts'

const base: ActivityContext = { resident: actor => actor === 'lantern' ? { type: 'resident', id: 7, name: actor, hasDrawing: true } : null,
  residentById: id => id === 7 ? { type: 'resident', id, name: 'lantern', hasDrawing: true } : null,
  place: id => ({ id, name: `room ${id}`, parentId: null, quiet: false, hasDrawing: false }), roomName: id => `room ${id}` }
const replay = { window_start: '2026-01-01T00:00:00Z', start: { 'resident:7': { place_id: 2 }, 'thing:9': { place_id: 2 } }, timeline: [
  { actor: 'lantern', at: '2026-01-01T00:01:00Z', change_id: '1', event_id: 1, kind: 'action', detail: { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 } },
  { actor: 'lantern', at: '2026-01-01T00:02:00Z', change_id: '2', event_id: 2, kind: 'thing_moved', detail: { thing_id: 9, place_id: 3 } },
  { actor: 'lantern', at: '2026-01-01T00:03:00Z', change_id: '3', event_id: 3, kind: 'effect_scheduled', detail: { effect_id: 5, place_id: 3, thing_id: 9 } },
  { actor: 'lantern', at: '2026-01-01T00:04:00Z', change_id: '4', event_id: 4, kind: 'action', detail: { action: 'move', status: 'applied', error: 'no', from_place_id: 3, to_place_id: 4 } },
  { actor: 'lantern', at: '2026-01-01T00:05:00Z', change_id: '5', event_id: 5, kind: 'thing_withdrawn', detail: { thing_id: 9 } },
], map: { places: [] } } as unknown as ReplayFile
const census = [{ id: 7, handle: 'lantern', has_drawing: true }] as Resident[]

test('historical context resolves only public records at the requested time', () => {
  const context = createHistoricalActivityContext(replay, census, base)
  assert.equal(context.actorRoom?.('lantern', Date.parse('2026-01-01T00:00:30Z')), 2)
  assert.equal(context.actorRoom?.('lantern', Date.parse('2026-01-01T00:01:30Z')), 3)
  assert.equal(context.thing?.(9, Date.parse('2026-01-01T00:01:30Z'))?.placeId, 2)
  assert.equal(context.thing?.(9, Date.parse('2026-01-01T00:02:30Z'))?.placeId, 3)
  assert.equal(context.effect?.(5, Date.parse('2026-01-01T00:02:30Z')), null)
  assert.deepEqual(context.effect?.(5, Date.parse('2026-01-01T00:03:30Z')), { placeId: 3, thingId: 9 })
  assert.equal(context.actorRoom?.('lantern', Date.parse('2026-01-01T00:04:30Z')), 3)
  assert.equal(context.thing?.(9, Date.parse('2026-01-01T00:05:30Z')), null)
})

test('quiet historical rooms are not exposed by anchor lookups', () => {
  const quietBase = { ...base, place: (id: number) => ({ id, name: `room ${id}`, parentId: null, quiet: id === 3, hasDrawing: false }) }
  const context = createHistoricalActivityContext(replay, census, quietBase)
  assert.equal(context.actorRoom?.('lantern', Date.parse('2026-01-01T00:03:30Z')), null)
  assert.equal(context.thing?.(9, Date.parse('2026-01-01T00:03:30Z')), null)
})
