import assert from 'node:assert/strict'
import test from 'node:test'

import type { ReplayEvent, ReplayFile } from '../src/city/types.ts'
import type { NestedLayout } from '../src/ground/nested.ts'
import { consumedThing, createdThing, createThings, effectFrame, movedThing, planThingSpots, stepThings, usedThing } from '../src/things.ts'

const rooms = {
  1: { id: 1, parentId: null, name: 'world', quiet: false, depth: 0, x: 0, y: 0, width: 300, height: 220, door: { x: 150, y: 220 }, standing: { x: 20, y: 20, width: 240, height: 160 }, children: [2] },
  2: { id: 2, parentId: 1, name: 'curtain', quiet: true, depth: 1, x: 340, y: 0, width: 180, height: 160, door: { x: 340, y: 80 }, standing: { x: 360, y: 20, width: 120, height: 100 }, children: [3] },
  3: { id: 3, parentId: 2, name: 'inside', quiet: false, depth: 2, x: 560, y: 0, width: 180, height: 160, door: { x: 560, y: 80 }, standing: { x: 580, y: 20, width: 120, height: 100 }, children: [] },
} as const
const layout = { rooms, roots: [1], rootId: 1, width: 760, height: 240 } as unknown as NestedLayout

const replay = (start: ReplayFile['start'], timeline: readonly ReplayEvent[] = []): ReplayFile => ({
  span: '1h', window_start: '2026-01-01T00:00:00Z', window_end: '2026-01-01T01:00:00Z', checkpoint: '1',
  complete: true, row_ceiling: 10, map: { places: [] }, start, counts: {}, timeline,
})
const event = (kind: string, detail: ReplayEvent['detail'], eventId = 1): ReplayEvent => ({
  actor: 'maker', at: '2026-01-01T00:00:01Z', change_id: String(eventId), event_id: eventId, kind, detail,
})

test('planning reserves deterministic floor spots from starts and created rows only', () => {
  const made = event('thing_created', { thing_id: 12, place_id: 1, name: 'lamp' })
  const plan = planThingSpots(replay({ 'thing:11': { place_id: 1 }, 'thing:bad': { place_id: 1 }, 'thing:13': { place_id: null } }, [made]), layout)
  assert.deepEqual(Object.keys(plan.spots).sort(), ['11', '12'])
  assert.equal(plan.spots[11]!.placeId, 1)
  assert.notDeepEqual([plan.spots[11]!.x, plan.spots[11]!.y], [plan.spots[12]!.x, plan.spots[12]!.y])
  assert.equal(plan.reservations[1]!.length, 2)
})

test('quiet rooms and their descendants do not get thing reservations', () => {
  const plan = planThingSpots(replay({ 'thing:1': { place_id: 2 }, 'thing:2': { place_id: 3 } }), layout)
  assert.deepEqual(plan.spots, {})
  assert.deepEqual(plan.reservations, {})
})

test('starts are nameless and inert until recorded rows act on them', () => {
  const state = createThings(replay({ 'thing:11': { place_id: 1 } }), layout)
  assert.equal(state.things[11]!.name, null)
  assert.equal(state.things[11]!.effect, null)
  assert.equal(state.pending, false)
})

test('creation uses the recorded name at its moment and a duplicate is safe', () => {
  const made = event('thing_created', { thing_id: 12, place_id: 1, name: 'small lamp' })
  const initial = createThings(replay({}, [made]), layout)
  const shown = stepThings(initial, [made], 100, 120)
  assert.equal(shown.things[12]!.name, 'small lamp')
  assert.equal(shown.things[12]!.effect?.kind, 'puff')
  const duplicate = stepThings(shown, [made], 100, 120)
  assert.equal(duplicate.things[12]!.name, 'small lamp')
})

test('use glows an already placed matching thing and ignores carried or unknown things', () => {
  const initial = createThings(replay({ 'thing:11': { place_id: 1 }, 'thing:12': { place_id: null } }), layout)
  const used = event('action', { action: 'use', status: 'applied', source_thing_id: 11, place_id: 1 })
  const carried = event('action', { action: 'use', status: 'applied', source_thing_id: 12, place_id: 1 }, 2)
  const next = stepThings(initial, [used, carried], 500, 120)
  assert.equal(next.things[11]!.effect?.kind, 'glow')
  assert.equal(next.things[12], undefined)
  assert.deepEqual(next.issues, [])
})

test('effects are bounded, speed-scaled holds with pure frames', () => {
  const initial = createThings(replay({ 'thing:11': { place_id: 1 } }), layout)
  const used = event('action', { action: 'use', status: 'applied', source_thing_id: 11, place_id: 1 })
  const slow = stepThings(initial, [used], 1_000, 60)
  const fast = stepThings(initial, [used], 1_000, 300)
  assert.ok(slow.things[11]!.effect!.expiresAt > fast.things[11]!.effect!.expiresAt)
  assert.deepEqual(effectFrame(slow.things[11]!.effect!, 999), { progress: 0, puff: false, glow: false, crumbs: false })
  assert.equal(effectFrame(slow.things[11]!.effect!, slow.things[11]!.effect!.expiresAt).progress, 1)
  assert.deepEqual(effectFrame(slow.things[11]!.effect!, Number.NaN), { progress: 0, puff: false, glow: false, crumbs: false })
  assert.equal(stepThings(slow, [], slow.things[11]!.effect!.expiresAt, 60).pending, false)
  assert.equal(initial.things[11]!.effect, null)
})

test('the current withdrawal row and older applied consume row show crumbs then remove the thing', () => {
  const initial = createThings(replay({ 'thing:11': { place_id: 1 } }), layout)
  const withdrawn = event('thing_withdrawn', { thing_id: 11 })
  const crumbling = stepThings(initial, [withdrawn], 100, 120)
  assert.equal(crumbling.things[11]!.effect?.kind, 'crumbs')
  const gone = stepThings(crumbling, [], crumbling.things[11]!.effect!.expiresAt, 120)
  assert.equal(gone.things[11], undefined)

  const legacy = createThings(replay({ 'thing:11': { place_id: 1 } }), layout)
  const consumed = event('action', { action: 'consume', status: 'applied', source_thing_id: 11, place_id: 1 })
  assert.equal(stepThings(legacy, [consumed], 100, 120).things[11]!.effect?.kind, 'crumbs')
  assert.equal(stepThings(legacy, [event('action', { action: 'consume', status: 'noop', source_thing_id: 11, place_id: 1 })], 100, 120).things[11]!.effect, null)
})

test('typed floor moves use a reserved destination and do not add an effect', () => {
  const moved = event('thing_moved', { thing_id: 11, from_place_id: 1, place_id: 3 })
  const visibleLayout = { ...layout, rooms: { ...rooms, 2: { ...rooms[2], quiet: false } } } as unknown as NestedLayout
  const state = createThings(replay({ 'thing:11': { place_id: 1 } }, [moved]), visibleLayout)
  const next = stepThings(state, [moved], 100, 120)
  assert.equal(next.things[11]!.placeId, 3)
  assert.equal(next.things[11]!.effect, null)
})

test('a later move to a lower numbered room does not hide the thing at replay start', () => {
  const moved = event('thing_moved', { thing_id: 11, from_place_id: 3, place_id: 1 })
  const visibleLayout = { ...layout, rooms: { ...rooms, 2: { ...rooms[2], quiet: false } } } as unknown as NestedLayout
  const state = createThings(replay({ 'thing:11': { place_id: 3 } }, [moved]), visibleLayout)
  assert.equal(state.things[11]!.placeId, 3)
})

test('event parsers accept only complete recorded facts', () => {
  assert.deepEqual(createdThing(event('thing_created', { thing_id: 5, place_id: 1, name: '  bell  ' })), { id: 5, placeId: 1, name: 'bell' })
  assert.deepEqual(movedThing(event('thing_moved', { thing_id: 5, place_id: 1 })), { id: 5, placeId: 1 })
  assert.equal(usedThing(event('action', { action: 'use', status: 'noop', source_thing_id: 5, place_id: 1 })), 5)
  assert.equal(consumedThing(event('thing_withdrawn', { thing_id: 5 })), 5)
  assert.equal(createdThing(event('thing_created', { thing_id: 0, place_id: 1 })), null)
  assert.equal(movedThing(event('thing_moved', { thing_id: 5 })), null)
  assert.equal(usedThing(event('action', { action: 'use', status: 'applied', source_thing_id: 5, place_id: 1, error: 'failed' })), null)
  assert.equal(consumedThing(event('action', { action: 'consume', status: 'applied', source_thing_id: 5 })), null)
})

test('a recorded move can establish an unknown floor thing or hide it in a quiet room', () => {
  const establish = event('thing_moved', { thing_id: 19, place_id: 1 })
  const state = createThings(replay({}, [establish]), layout)
  const shown = stepThings(state, [establish], 100)
  assert.equal(shown.things[19]!.placeId, 1)
  const hidden = stepThings(shown, [event('thing_moved', { thing_id: 19, place_id: 2 }, 2)], 200)
  assert.equal(hidden.things[19]!.visible, false)
})

test('overflow keeps timeline-touched things first and never invents from checkpoint counts', () => {
  const tinyRooms = { ...rooms, 1: { ...rooms[1], standing: { x: 20, y: 20, width: 64, height: 64 } } }
  const tiny = { ...layout, rooms: tinyRooms } as unknown as NestedLayout
  const made = event('thing_created', { thing_id: 9, place_id: 1, name: 'kept' })
  const used = event('action', { action: 'use', status: 'noop', source_thing_id: 9, place_id: 1 }, 2)
  const input = { ...replay({ 'thing:1': { place_id: 1 } }, [made, used]), counts: { '1': { residents: 0, things: 99 } } }
  const plan = planThingSpots(input, tiny)
  assert.equal(plan.reservations[1]!.some(spot => spot.key === 'thing:9'), true)
  assert.equal(plan.reservations[1]!.some(spot => spot.key === 'thing:1'), false)
  assert.deepEqual(plan.issues, ['Some things did not fit on the floor, so they are not shown.'])
})

test('a removal remains gone when a later use or duplicate removal arrives during its crumbs', () => {
  const initial = createThings(replay({ 'thing:11': { place_id: 1 } }), layout)
  const removed = event('thing_withdrawn', { thing_id: 11 })
  const crumbs = stepThings(initial, [removed], 100)
  const later = stepThings(crumbs, [event('action', { action: 'use', status: 'noop', source_thing_id: 11, place_id: 1 }), removed], 150)
  assert.deepEqual(later.things[11]!.effect, crumbs.things[11]!.effect)
  assert.equal(stepThings(later, [], crumbs.things[11]!.effect!.expiresAt).things[11], undefined)
})

test('same-batch effects play in recorded order instead of overwriting one another', () => {
  const made = event('thing_created', { thing_id: 12, place_id: 1, name: 'lamp' })
  const used = event('action', { action: 'use', status: 'applied', source_thing_id: 12, place_id: 1 }, 2)
  const removed = event('thing_withdrawn', { thing_id: 12 }, 3)
  let state = createThings(replay({}, [made]), layout)
  state = stepThings(state, [made, used, removed], 100)
  assert.equal(state.things[12]!.effect?.kind, 'puff')
  assert.equal(state.queue.length, 2)
  state = stepThings(state, [], state.things[12]!.effect!.expiresAt)
  assert.equal(state.things[12]!.effect?.kind, 'glow')
  assert.equal(state.queue.length, 1)
  state = stepThings(state, [], state.things[12]!.effect!.expiresAt)
  assert.equal(state.things[12]!.effect?.kind, 'crumbs')
  state = stepThings(state, [], state.things[12]!.effect!.expiresAt)
  assert.equal(state.things[12], undefined)
  assert.equal(state.pending, false)
})

test('repeated uses on one thing glow sequentially', () => {
  const use1 = event('action', { action: 'use', status: 'noop', source_thing_id: 11, place_id: 1 })
  const use2 = { ...use1, event_id: 2, change_id: '2' }
  let state = stepThings(createThings(replay({ 'thing:11': { place_id: 1 } }), layout), [use1, use2], 100)
  const firstExpiry = state.things[11]!.effect!.expiresAt
  assert.equal(state.queue.length, 1)
  state = stepThings(state, [], firstExpiry)
  assert.equal(state.things[11]!.effect?.startedAt, firstExpiry)
  assert.equal(state.queue.length, 0)
})

test('a known thing keeps its recorded name while hidden and after returning', () => {
  const made = event('thing_created', { thing_id: 12, place_id: 1, name: 'lamp' })
  let state = stepThings(createThings(replay({}, [made]), layout), [made], 100)
  state = stepThings(state, [], state.things[12]!.effect!.expiresAt)
  state = stepThings(state, [event('thing_moved', { thing_id: 12, place_id: 2 }, 2)], 2_000)
  assert.equal(state.things[12]!.visible, false)
  assert.equal(state.things[12]!.name, 'lamp')
  state = stepThings(state, [event('thing_moved', { thing_id: 12, place_id: 1 }, 3)], 2_100)
  assert.equal(state.things[12]!.visible, true)
  assert.equal(state.things[12]!.name, 'lamp')
})

test('hidden things do not animate and a hidden withdrawal removes immediately', () => {
  const initial = createThings(replay({ 'thing:11': { place_id: 1 } }), layout)
  const hidden = stepThings(initial, [event('thing_moved', { thing_id: 11, place_id: 2 })], 100)
  const used = stepThings(hidden, [event('action', { action: 'use', status: 'noop', source_thing_id: 11, place_id: 2 })], 200)
  assert.equal(used.things[11]!.effect, null)
  assert.equal(used.pending, false)
  const removed = stepThings(used, [event('thing_withdrawn', { thing_id: 11 })], 300)
  assert.equal(removed.things[11], undefined)
})
