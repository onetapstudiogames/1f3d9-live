import assert from 'node:assert/strict'
import test from 'node:test'
import { createHistoricalActivityContext } from '../src/activity-context.ts'
import { activityEntry, type ActivityContext } from '../src/activity.ts'
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

test('quiet historical placement suppresses related activity without suppressing room-free records', () => {
  const quietBase = { ...base, place: (id: number) => ({ id, name: `room ${id}`, parentId: null, quiet: id === 2, hasDrawing: false }) }
  const context = createHistoricalActivityContext(replay, census, quietBase)
  const at = '2026-01-01T00:00:30Z'
  const event = (kind: string, detail: Record<string, unknown>) => ({ actor: 'lantern', at, change_id: '20', event_id: 20, kind, detail })
  assert.equal(activityEntry(event('thing_edited', { thing_id: 9 }), context), null)
  assert.equal(activityEntry(event('action', { action: 'use', status: 'applied', source_thing_id: 9 }), context), null)
  assert.equal(activityEntry(event('action', { action: 'use', status: 'failed', source_thing_id: 9, error: 'hidden' }), context), null)
  assert.equal(activityEntry(event('rotate', {}), context)?.text, 'lantern rotated their key.')
})

test('a public actor cannot expose a historically quiet thing name', () => {
  const splitReplay = { ...replay, start: { 'resident:7': { place_id: 1 }, 'thing:9': { place_id: 2 } }, timeline: [] } as unknown as ReplayFile
  const splitBase = { ...base, place: (id: number) => ({ id, name: `room ${id}`, parentId: null, quiet: id === 2, hasDrawing: false }) }
  const context = createHistoricalActivityContext(splitReplay, census, splitBase)
  const event = { actor: 'lantern', at: '2026-01-01T00:00:30Z', change_id: '21', event_id: 21, kind: 'thing_edited',
    detail: { thing_id: 9, name: 'private keepsake' } }
  assert.equal(activityEntry(event, context), null)
  assert.equal(activityEntry({ ...event, change_id: '24', event_id: 24, kind: 'transfer_offer',
    detail: { offer_id: 4, asset_type: 'thing', asset_id: 9 } }, context), null)
})

test('an unmapped room is hidden evidence rather than a public or absent placement', () => {
  const missingBase = { ...base, place: (id: number) => id === 1 ? base.place(id) : null }
  const context = createHistoricalActivityContext(replay, census, missingBase)
  const event = { actor: 'lantern', at: '2026-01-01T00:00:30Z', change_id: '22', event_id: 22, kind: 'thing_edited',
    detail: { thing_id: 9, name: 'unmapped keepsake' } }
  assert.equal(activityEntry(event, context), null)
})

test('a withdrawal at the replay boundary retains the quiet starting placement for privacy', () => {
  const boundaryReplay = { ...replay, start: { 'resident:7': { place_id: 1 }, 'thing:9': { place_id: 2 } }, timeline: [
    { actor: 'lantern', at: replay.window_start, change_id: '23', event_id: 23, kind: 'thing_withdrawn', detail: { thing_id: 9, name: 'private keepsake' } },
  ] } as unknown as ReplayFile
  const quietBase = { ...base, place: (id: number) => ({ id, name: `room ${id}`, parentId: null, quiet: id === 2, hasDrawing: false }) }
  const context = createHistoricalActivityContext(boundaryReplay, census, quietBase)
  assert.equal(activityEntry(boundaryReplay.timeline[0]!, context), null)
})
