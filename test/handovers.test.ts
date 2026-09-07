import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ReplayEvent, ReplayFile, Resident } from '../src/city/types.ts'
import type { NestedLayout } from '../src/ground/nested.ts'
import { createHandovers, stepHandovers } from '../src/handovers.ts'
import { createResidents, stepResidents } from '../src/replay/simulation.ts'
import { createThings, stepThings } from '../src/things.ts'

const rooms = {
  1: { id: 1, parentId: null, name: 'world', quiet: false, depth: 0, x: 0, y: 0, width: 300, height: 200, door: { x: 290, y: 100 }, standing: { x: 20, y: 20, width: 240, height: 140 }, children: [2, 3] },
  2: { id: 2, parentId: 1, name: 'room', quiet: false, depth: 1, x: 400, y: 0, width: 220, height: 180, door: { x: 400, y: 90 }, standing: { x: 420, y: 20, width: 160, height: 120 }, children: [] },
  3: { id: 3, parentId: 1, name: 'quiet', quiet: true, depth: 1, x: 400, y: 240, width: 220, height: 180, door: { x: 400, y: 330 }, standing: { x: 420, y: 260, width: 160, height: 120 }, children: [] },
} as const
const layout = { rooms, rootId: 1, roots: [1], width: 640, height: 440 } as unknown as NestedLayout
const census: readonly Resident[] = [
  { id: 7, handle: 'giver', current_place_id: 2, model: '', joined_at: '', has_drawing: false, asleep: false },
  { id: 8, handle: 'receiver', current_place_id: 2, model: '', joined_at: '', has_drawing: false, asleep: false },
]
const replay = (timeline: readonly ReplayEvent[] = []): ReplayFile => ({
  span: '1h', window_start: '2026-01-01T00:00:00Z', window_end: '2026-01-01T01:00:00Z', checkpoint: '1', complete: true, row_ceiling: 20,
  map: { places: [] }, start: { 'resident:7': { place_id: 2 }, 'resident:8': { place_id: 2 } }, counts: {}, timeline,
})
const row = (changeId: string, kind: string, detail: ReplayEvent['detail'], actor = 'giver'): ReplayEvent => ({
  actor, at: '2026-01-01T00:00:01Z', change_id: changeId, event_id: Number(changeId), kind, detail,
})

test('live carry fixture has one exact notice/action pair', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/changes-carry-live.json', import.meta.url), 'utf8')) as { changes: Array<Record<string, unknown>> }
  const events = fixture.changes.map((item, index) => ({ ...item, at: item.created_at, event_id: index + 1 })) as ReplayEvent[]
  const state = createHandovers(events)
  assert.equal(state.carries.length, 1)
  assert.equal(state.carries[0]?.thingId, 2727)
  assert.equal(state.carries[0]?.actionChangeId, '99575')
})

test('a carried thing appears only on its exact recorded walk and releases its notice at arrival', () => {
  const notice = row('10', 'thing_moved', { mode: 'carry', thing_id: 44, action_id: 5, resident_id: 7, from_place_id: 2, place_id: 1 })
  const action = row('11', 'action', { mode: 'carry', action: 'move', status: 'applied', thing_id: 44, action_id: 5, from_place_id: 2, to_place_id: 1 })
  let residents = createResidents(replay([notice, action]), census, layout)
  let handovers = createHandovers([notice, action])
  residents = stepResidents(residents, [action], 0, 100, layout)
  let stepped = stepHandovers(handovers, [notice, action], residents, layout, 100)
  assert.equal(residents.residents[7]?.walkEventId, '11')
  assert.deepEqual(stepped.carryThingIds, [44])
  assert.equal(stepped.motions[0]?.visible, true)
  assert.deepEqual(stepped.floorEvents, [])

  residents = stepResidents(residents, [], 10_000, 10_100, layout)
  stepped = stepHandovers(stepped.state, [], residents, layout, 10_100)
  assert.deepEqual(stepped.floorEvents.map(event => event.change_id), ['10'])
  assert.deepEqual(stepped.carryThingIds, [])
})

test('ordinary walks never carry and an unknown carrier safely releases the notice', () => {
  const notice = row('20', 'thing_moved', { mode: 'carry', thing_id: 45, action_id: 8, resident_id: 99, from_place_id: 2, place_id: 1 }, 'missing')
  const action = row('21', 'action', { mode: 'carry', action: 'move', status: 'applied', thing_id: 45, action_id: 8, from_place_id: 2, to_place_id: 1 }, 'missing')
  const state = createHandovers([notice, action])
  const stepped = stepHandovers(state, [notice, action], createResidents(replay(), census, layout), layout, 100)
  assert.deepEqual(stepped.floorEvents.map(event => event.change_id), ['20'])
  assert.deepEqual(stepped.motions, [])
  assert.deepEqual(stepped.carryThingIds, [])
})

test('a notice may arrive before its action without holding the replay clock', () => {
  const notice = row('30', 'thing_moved', { mode: 'carry', thing_id: 46, action_id: 9, resident_id: 7, from_place_id: 2, place_id: 1 })
  const action = row('31', 'action', { mode: 'carry', action: 'move', status: 'applied', thing_id: 46, action_id: 9, from_place_id: 2, to_place_id: 1 })
  const residents = createResidents(replay(), census, layout)
  const first = stepHandovers(createHandovers([notice, action]), [notice], residents, layout, 100)
  assert.equal(first.pending, false)
  assert.deepEqual(first.floorEvents, [])
})

test('gift starts when its queue turn arrives, keeps floor state fixed, and blocks only its giver', () => {
  const note = { ...row('40', 'note', { place_id: 2 }), line: 'first' }
  const gift = row('41', 'transfer', { mode: 'gift', transfer_id: 41, asset_id: 50, asset_type: 'thing', resident_id: 8, place_id: 2 })
  let state = createResidents(replay([note, gift]), census, layout)
  state = stepResidents(state, [note, gift], 0, 100, layout)
  assert.deepEqual(state.startedTransfers, [])
  state = stepResidents(state, [], 0, 10_000, layout)
  assert.equal(state.startedTransfers[0]?.transfer.thingId, 50, JSON.stringify(state))
  assert.ok((state.residents[7]?.transferUntil ?? 0) > 10_000)
  const motion = stepHandovers(createHandovers([]), [], state, layout, 10_000)
  assert.equal(motion.motions[0]?.heart !== undefined, true)
  assert.deepEqual(motion.floorEvents, [])
  const replayWithThing = { ...replay(), start: { ...replay().start, 'thing:50': { place_id: 2 } } }
  const things = createThings(replayWithThing, layout)
  assert.deepEqual(stepThings(things, motion.floorEvents, 10_000).things[50], things.things[50])
})

test('gift skips hidden rooms and missing partners without a hold', () => {
  const hiddenCensus = census.map(person => ({ ...person, current_place_id: 3 }))
  const gift = row('50', 'transfer', { mode: 'gift', transfer_id: 50, asset_id: 51, asset_type: 'thing', resident_id: 8, place_id: 3 })
  const hiddenReplay = { ...replay([gift]), start: { 'resident:7': { place_id: 3 }, 'resident:8': { place_id: 3 } } }
  const state = stepResidents(createResidents(hiddenReplay, hiddenCensus, layout), [gift], 0, 100, layout)
  assert.deepEqual(state.startedTransfers, [])
  assert.equal(state.residents[7]?.transferUntil, null)
})

test('a queued gift waits for the preceding walk and starts from the arrived room', () => {
  const move = row('60', 'action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 1 })
  const gift = row('61', 'transfer', { mode: 'gift', transfer_id: 61, asset_id: 52, asset_type: 'thing', resident_id: 8, place_id: 1 })
  const movedCensus = census.map(person => person.id === 8 ? { ...person, current_place_id: 1 } : person)
  const movedReplay = { ...replay([move, gift]), start: { 'resident:7': { place_id: 2 }, 'resident:8': { place_id: 1 } } }
  let state = stepResidents(createResidents(movedReplay, movedCensus, layout), [move, gift], 0, 100, layout)
  assert.deepEqual(state.startedTransfers, [])
  state = stepResidents(state, [], 10_000, 10_100, layout)
  assert.equal(state.residents[7]?.placeId, 1)
  assert.equal(state.startedTransfers[0]?.transfer.thingId, 52, JSON.stringify(state))
  const paused = stepResidents(state, [], 0, 10_100, layout)
  assert.deepEqual(paused.startedTransfers, [])
  assert.equal(paused.residents[7]?.transferUntil, state.residents[7]?.transferUntil)
})

test('consecutive carries keep later same-thing rows behind the correct walk', () => {
  const notice1 = row('70', 'thing_moved', { mode: 'carry', thing_id: 53, action_id: 70, resident_id: 7, from_place_id: 2, place_id: 1 })
  const action1 = row('71', 'action', { mode: 'carry', action: 'move', status: 'applied', thing_id: 53, action_id: 70, from_place_id: 2, to_place_id: 1 })
  const notice2 = row('72', 'thing_moved', { mode: 'carry', thing_id: 53, action_id: 71, resident_id: 7, from_place_id: 1, place_id: 2 })
  const action2 = row('73', 'action', { mode: 'carry', action: 'move', status: 'applied', thing_id: 53, action_id: 71, from_place_id: 1, to_place_id: 2 })
  const use = row('74', 'action', { action: 'use', status: 'applied', source_thing_id: 53, place_id: 2 })
  const all = [notice1, action1, notice2, action2, use]
  let residents = stepResidents(createResidents(replay(all), census, layout), [action1, action2], 0, 100, layout)
  let frame = stepHandovers(createHandovers(all), all, residents, layout, 100)
  assert.deepEqual(frame.floorEvents, [])
  residents = stepResidents(residents, [], 10_000, 10_100, layout)
  frame = stepHandovers(frame.state, [], residents, layout, 10_100)
  assert.deepEqual(frame.floorEvents.map(event => event.change_id), ['70'])
  assert.deepEqual(frame.carryThingIds, [53])
  residents = stepResidents(residents, [], 10_000, 20_100, layout)
  frame = stepHandovers(frame.state, [], residents, layout, 20_100)
  assert.deepEqual(frame.floorEvents.map(event => event.change_id), ['72', '74'])
})

test('an action arriving before its paired notice does not deadlock', () => {
  const notice = row('80', 'thing_moved', { mode: 'carry', thing_id: 54, action_id: 80, resident_id: 7, from_place_id: 2, place_id: 1 })
  const action = row('81', 'action', { mode: 'carry', action: 'move', status: 'applied', thing_id: 54, action_id: 80, from_place_id: 2, to_place_id: 1 })
  let residents = stepResidents(createResidents(replay([notice, action]), census, layout), [action], 0, 100, layout)
  let frame = stepHandovers(createHandovers([notice, action]), [action], residents, layout, 100)
  frame = stepHandovers(frame.state, [notice], residents, layout, 100)
  assert.deepEqual(frame.carryThingIds, [54])
  residents = stepResidents(residents, [], 10_000, 10_100, layout)
  frame = stepHandovers(frame.state, [], residents, layout, 10_100)
  assert.deepEqual(frame.floorEvents.map(event => event.change_id), ['80'])
})
