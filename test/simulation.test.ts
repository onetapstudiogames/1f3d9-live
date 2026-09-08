import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ReplayEvent, ReplayFile, Resident } from '../src/city/types.ts'
import { nestedLayout, type NestedLayout } from '../src/ground/nested.ts'
import { roomContains } from '../src/ground/room-shape.ts'
import { ROOM_RESIDENT_SIZE } from '../src/room-appearance.ts'
import { blocksLiveDelivery, createResidents, retimeResidentWalks, roomCapacity, stepIdleResidents, stepResidents } from '../src/replay/simulation.ts'
import type { ThingReservations } from '../src/things.ts'
import { followActivity, reappearanceAlpha } from '../src/viewer.ts'

const rooms = {
  1: { id: 1, parentId: null, name: 'world', quiet: false, depth: 0, x: 0, y: 0, width: 320, height: 240, door: { x: 300, y: 120 }, standing: { x: 20, y: 20, width: 260, height: 180 }, children: [2, 3] },
  2: { id: 2, parentId: 1, name: 'loud', quiet: false, depth: 1, x: 400, y: 0, width: 220, height: 180, door: { x: 400, y: 90 }, standing: { x: 420, y: 20, width: 160, height: 130 }, children: [] },
  3: { id: 3, parentId: 1, name: 'quiet', quiet: true, depth: 1, x: 400, y: 260, width: 220, height: 180, door: { x: 400, y: 350 }, standing: { x: 420, y: 280, width: 160, height: 130 }, children: [] },
} as const
const layout = { rooms, roots: [1], width: 640, height: 460 } as unknown as NestedLayout

const census: readonly Resident[] = [
  { id: 7, handle: 'walker', current_place_id: 2, model: '', joined_at: '', has_drawing: false, asleep: false },
  { id: 8, handle: 'still', current_place_id: 2, model: '', joined_at: '', has_drawing: false, asleep: false },
]
const replay = (start: ReplayFile['start'] = { 'resident:7': { origin_event_id: 1, place_id: 2 }, 'resident:8': { origin_event_id: 1, place_id: 2 } }): ReplayFile => ({
  span: '1h', window_start: '2026-01-01T00:00:00Z', window_end: '2026-01-01T01:00:00Z', checkpoint: '1',
  complete: true, row_ceiling: 10, map: { places: [] }, start, counts: {}, timeline: [],
})
const event = (kind: string, detail: ReplayEvent['detail'], line?: string): ReplayEvent => ({
  actor: 'walker', at: '2026-01-01T00:00:01Z', change_id: '1', event_id: 1, kind, detail, line,
})

test('room capacity includes unique initial and applied destination residents', () => {
  const data = replay()
  const withEvents = { ...data, timeline: [
    event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 }),
    { ...event('note', { place_id: 3 }, 'hello'), actor: 'newcomer' },
  ] }
  assert.deepEqual(roomCapacity(withEvents, census), { 2: 2, 3: 2 })
})

test('initial residents receive deterministic non-overlapping centered spots without mutating inputs', () => {
  const input = replay()
  const before = JSON.stringify(input)
  const state = createResidents(input, census, layout)
  const first = state.residents[7]!
  const second = state.residents[8]!
  assert.equal(JSON.stringify(input), before)
  assert.notDeepEqual([first.x, first.y], [second.x, second.y])
  assert.ok(first.x >= rooms[2].standing.x + 16)
  assert.equal(state.actors.get('walker'), 7)
})

test('room capacity makes space for recorded floor things and future creations, never checkpoint totals', () => {
  const data = replay()
  const made = event('thing_created', { thing_id: 46, place_id: 2, name: 'small parcel' })
  const record = { ...data, start: { ...data.start, 'thing:44': { place_id: 2 }, 'thing:45': { place_id: null } },
    counts: { 2: { residents: 100, things: 150 } }, timeline: [made, made] }
  assert.deepEqual(roomCapacity(record, census), { 2: 4 })
})

test('fixed thing reservations keep residents 48 px clear of present and future thing spots', () => {
  // Reserve the exact cell a resident takes when nothing is reserved, so ignoring
  // reservations would put it right back on the thing and fail this test.
  const free = createResidents(replay(), census, layout)
  const taken = free.residents[7]!
  const reserved: ThingReservations = {
    2: [{ key: 'thing:44', kind: 'thing', x: taken.x - 16, y: taken.y - 16, width: 32, height: 32 }],
  }
  const spot = reserved[2]![0]!
  const state = createResidents(replay(), census, layout, reserved)

  assert.equal(state.reservations, reserved)
  assert.notDeepEqual([state.residents[7]!.x, state.residents[7]!.y], [taken.x, taken.y])
  for (const resident of Object.values(state.residents)) {
    const apart = Math.abs(resident.x - 16 - spot.x) >= 48 || Math.abs(resident.y - 16 - spot.y) >= 48
    assert.equal(apart, true, `resident ${resident.id} stands inside the reserved thing's 48 px clearance`)
  }
})

test('a walk finishes before the following note is shown', () => {
  let state = createResidents(replay(), census, layout)
  const move = event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 })
  const note = event('note', { place_id: 3 }, 'arrived')
  state = stepResidents(state, [move, note], 100, 100, layout)
  assert.equal(state.residents[7]!.walking, true)
  assert.equal(state.residents[7]!.bubble, null)
  assert.equal(state.pending, true)
  const completed = stepResidents(state, [], 10_000, 10_100, layout)
  assert.equal(completed.residents[7]!.placeId, 3)
  assert.equal(completed.residents[7]!.walking, false)
  const arrived = completed.residents[7]!.bubble
  assert.equal(arrived && arrived.text, 'arrived')
  assert.equal(completed.residents[7]!.visible, false)
})

test('an active normal walk keeps its captured pace when the control speed changes', () => {
  let state = createResidents(replay(), census, layout)
  const move = event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 1 })
  state = stepResidents(state, [move], 0, 0, layout, 1)
  const duration = state.residents[7]!.walkDuration
  state = stepResidents(state, [], 1_000, 1_000, layout, 60)
  assert.equal(state.residents[7]!.walkDuration, duration)
  assert.equal(state.residents[7]!.walkSpeed, 1)
  assert.ok(Math.abs(state.residents[7]!.walkElapsed - 1_000) < 0.001)
})

test('retiming an active walk preserves its exact position and metadata in both directions', () => {
  const move = event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 1 })
  let fast = stepResidents(createResidents(replay(), census, layout), [move], 0, 0, layout, 60)
  fast = stepResidents(fast, [], 500, 500, layout, 60)
  const before = fast.residents[7]!
  const normal = retimeResidentWalks(fast, 1, layout)
  const after = normal.residents[7]!
  assert.deepEqual([after.x, after.y, after.path, after.queue, after.walkEventId, after.lastActivityId],
    [before.x, before.y, before.path, before.queue, before.walkEventId, before.lastActivityId])
  assert.equal(after.walkSpeed, 1)
  const next = stepResidents(normal, [], 1_000, 1_500, layout, 1).residents[7]!
  assert.ok(Math.hypot(next.x - after.x, next.y - after.y) <= 40.01)

  const refast = retimeResidentWalks(normal, 60, layout)
  assert.deepEqual([refast.residents[7]!.x, refast.residents[7]!.y], [after.x, after.y])
  assert.equal(refast.residents[7]!.walkSpeed, 60)
})

test('startedEvents reports records when their visual queue turn begins', () => {
  let state = createResidents(replay(), census, layout)
  const move = event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 1 })
  const note = { ...event('note', { place_id: 1 }, 'arrived'), change_id: '2' }
  state = stepResidents(state, [move, note], 0, 0, layout)
  assert.deepEqual(state.startedEvents?.map(row => row.change_id), ['1'])
  state = stepResidents(state, [], 100_000, 100_000, layout)
  assert.deepEqual(state.startedEvents?.map(row => row.change_id), ['2'])
})

test('normal replay keeps non-walk visual holds at the readable 60x ceiling', () => {
  const state = createResidents(replay(), census, layout)
  const next = stepResidents(state, [event('note', { place_id: 2 }, 'hello')], 0, 1_000, layout, 1)
  assert.equal(next.residents[7]!.bubble?.expiresAt, 11_000)
})

test('follow resumes on the next started record, never on an already queued note or idle frame', () => {
  let state = createResidents(replay(), census, layout)
  const move = event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 1 })
  const note = { ...event('note', { place_id: 1 }, 'arrived'), change_id: '2' }
  state = stepResidents(state, [move, note], 100, 100, layout)
  const browsing = { residentId: 7, suspended: true, activityId: state.residents[7]!.lastActivityId ?? null }
  assert.equal(browsing.activityId, '1')
  state = stepResidents(state, [], 1, 101, layout)
  assert.equal(followActivity(browsing, 7, state.residents[7]!.lastActivityId ?? null), browsing)
  state = stepResidents(state, [], 100_000, 100_101, layout)
  assert.equal(state.residents[7]!.lastActivityId, '2')
  assert.equal(followActivity(browsing, 7, state.residents[7]!.lastActivityId ?? null).suspended, false)
})

test('a missing route reappears at the recorded room without inventing a walk', () => {
  const state = createResidents(replay(), census, layout)
  const next = stepResidents(state, [event('note', { place_id: 1 }, 'here')], 100, 100, layout).residents[7]!
  assert.equal(next.placeId, 1)
  assert.equal(next.walking, false)
  assert.equal(next.relocatedAt, 100)
  assert.equal(reappearanceAlpha(next.relocatedAt, 100), 0)
  assert.equal(reappearanceAlpha(next.relocatedAt, 300), 0.5)
  assert.equal(reappearanceAlpha(next.relocatedAt, 500), 1)
  assert.equal(reappearanceAlpha(undefined, 100), 1)
})

test('idle wandering is deterministic, stays in the room, and never holds replay', () => {
  const initial = createResidents(replay(), census, layout)
  const due = stepIdleResidents(initial, 0, 60_000, layout)
  const again = stepIdleResidents(initial, 0, 60_000, layout)
  assert.deepEqual(due.residents[7], again.residents[7])
  const moving = Object.values(due.residents).find(row => row.ambientWalking)
  assert.ok(moving)
  assert.equal(due.pending, false)
  assert.equal(moving.lastActivityId, undefined)
  const advanced = stepIdleResidents(due, 500, 60_500, layout)
  const row = advanced.residents[moving.id]!
  assert.equal(row.placeId, moving.placeId)
  assert.ok(row.x >= rooms[2].standing.x && row.x <= rooms[2].standing.x + rooms[2].standing.width)
  assert.ok(row.y >= rooms[2].standing.y && row.y <= rooms[2].standing.y + rooms[2].standing.height)
  assert.equal(roomContains(rooms[2], row), true)
})

test('idle wandering excludes sleepers and quiet rooms', () => {
  const quietCensus = census.map(row => ({ ...row, current_place_id: 3 }))
  const quietState = createResidents(replay({ 'resident:7': { place_id: 3 }, 'resident:8': { place_id: 3 } }), quietCensus, layout)
  assert.deepEqual(stepIdleResidents(quietState, 0, 60_000, layout).residents, quietState.residents)
  const awakeState = createResidents(replay(), census, layout)
  assert.deepEqual(stepIdleResidents(awakeState, 0, 60_000, layout, new Set([7, 8])).residents, awakeState.residents)
})

test('an active ambient walk stops at its current point when sleep or a new obstacle makes it unsafe', () => {
  const initial = createResidents(replay(), census, layout)
  const moving = stepIdleResidents(initial, 0, 60_000, layout)
  const active = Object.values(moving.residents).find(row => row.ambientWalking)!
  const sleeping = stepIdleResidents(moving, 500, 60_500, layout, new Set([active.id])).residents[active.id]!
  assert.equal(sleeping.ambientWalking, false)
  assert.deepEqual([sleeping.x, sleeping.y], [active.x, active.y])

  const movingAgain = stepIdleResidents(initial, 0, 60_000, layout)
  const walker = Object.values(movingAgain.residents).find(row => row.ambientWalking)!
  const blocked = { ...movingAgain, reservations: { ...movingAgain.reservations,
    [walker.placeId!]: [{ key: 'thing:new', kind: 'thing' as const, x: walker.x - 16, y: walker.y - 16, width: 32, height: 32 }] } }
  const stopped = stepIdleResidents(blocked, 500, 60_500, layout).residents[walker.id]!
  assert.equal(stopped.ambientWalking, false)
  assert.deepEqual([stopped.x, stopped.y], [walker.x, walker.y])
})

test('inventions take their actor queue turn between walks and words, one at a time', () => {
  let state = createResidents(replay(), census, layout)
  const move = event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 1 })
  const first = event('kind_invented', { name: 'lamp moss', kind_id: 4 })
  const second = { ...event('trait_coined', { name: 'patient', trait_id: 9 }), change_id: '2', event_id: 2 }
  const note = event('note', { place_id: 1 }, 'done')
  state = stepResidents(state, [move, first, second, note], 100, 100, layout)
  assert.equal(state.residents[7]!.walking, true)
  assert.deepEqual(state.startedInventions, [])
  state = stepResidents(state, [], 10_000, 10_100, layout)
  assert.equal(state.startedInventions?.[0]?.invention.name, 'lamp moss')
  assert.equal(state.residents[7]!.bubble, null)
  state = stepResidents(state, [], 0, 12_300, layout)
  assert.equal(state.startedInventions?.[0]?.invention.name, 'patient')
  state = stepResidents(state, [], 0, 14_500, layout)
  assert.deepEqual(state.residents[7]!.bubble, { text: 'done', cut: false, placeId: 1,
    startedAt: 14_500, charInterval: 34, expiresAt: 19_500 })
})

test('a full destination reports no free spot rather than no path', () => {
  const fullDestination = {
    ...layout,
    rooms: {
      ...rooms,
      3: { ...rooms[3], standing: { x: 420, y: 280, width: 80, height: 80 } },
    },
  } as unknown as NestedLayout
  const start = {
    'resident:7': { origin_event_id: 1, place_id: 2 },
    'resident:8': { origin_event_id: 1, place_id: 3 },
  }
  const state = createResidents(replay(start), census, fullDestination)
  const move = event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 })
  const next = stepResidents(state, [move], 0, 0, fullDestination)
  assert.deepEqual(next.issues, ['Some rooms had no free spot left, so those figures were not moved into them.'])
})

test('a moving resident cannot take space covered by another resident 56-pixel footprint', () => {
  const tightDestination = { ...layout, rooms: { ...rooms,
    3: { ...rooms[3], standing: { x: 0, y: 0, width: 160, height: 160 } } } } as unknown as NestedLayout
  const start = { 'resident:7': { origin_event_id: 1, place_id: 2 },
    'resident:8': { origin_event_id: 1, place_id: 3 } }
  const initial = createResidents(replay(start), census, tightDestination)
  const residentEight = { ...initial.residents[8]!, x: 75, y: 75 }
  const state = { ...initial, residents: { ...initial.residents, 8: residentEight } }
  const move = event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 })
  const next = stepResidents(state, [move], 0, 0, tightDestination)

  assert.equal(next.residents[7]!.walking, false)
  assert.deepEqual(next.issues, ['Some rooms had no free spot left, so those figures were not moved into them.'])
})

test('same-room applied move establishes an absent resident without walking', () => {
  const establishing = event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 2 })
  const absent = { ...replay({}), timeline: [establishing] }
  const state = createResidents(absent, census, layout)
  assert.equal(state.residents[7]!.placeId, null)
  const moved = stepResidents(state, [establishing], 16, 16, layout)
  assert.equal(moved.residents[7]!.placeId, 2)
  assert.equal(moved.residents[7]!.walking, false)
})

test('replay-only resident starts survive a missing census', () => {
  const state = createResidents(replay({ 'resident:99': { origin_event_id: 1, place_id: 2 } }), [], layout)
  assert.equal(state.residents[99]!.placeId, 2)
  assert.equal(state.residents[99]!.handle, 'resident:99')
})

test('an absent actor starts a real walk at its recorded source', () => {
  const move = event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 })
  const state = createResidents({ ...replay({}), timeline: [move] }, census, layout)
  const next = stepResidents(state, [move], 0, 0, layout)
  assert.equal(next.residents[7]!.walking, true)
  assert.equal(next.residents[7]!.placeId, 2)
})

test('source mismatch resumes at the recorded source without connecting from the stale room', () => {
  const state = createResidents(replay(), census, layout)
  const mismatch = event('action', { action: 'move', status: 'applied', from_place_id: 1, to_place_id: 3 })
  const next = stepResidents(state, [mismatch], 0, 100, layout)
  assert.equal(next.residents[7]!.placeId, 1)
  assert.equal(next.residents[7]!.walking, true)
  assert.ok(next.residents[7]!.x >= rooms[1].standing.x && next.residents[7]!.x <= rooms[1].standing.x + rooms[1].standing.width)
  assert.deepEqual(next.issues, ['The record skips part of some routes; those figures reappear at their next recorded room.'])
})

test('error-bearing moves never walk', () => {
  const state = createResidents(replay(), census, layout)
  const failed = event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3, error: 'denied' })
  const next = stepResidents(state, [failed], 100, 100, layout)
  assert.equal(next.residents[7]!.placeId, 2)
  assert.equal(next.residents[7]!.walking, false)
})

test('same-room applied move retains an existing presentation spot', () => {
  const state = createResidents(replay(), census, layout)
  const before = state.residents[7]!
  const next = stepResidents(state, [event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 2 })], 0, 0, layout)
  assert.deepEqual([next.residents[7]!.x, next.residents[7]!.y], [before.x, before.y])
})

test('a note with a newer recorded room resumes there before speaking', () => {
  const state = createResidents(replay(), census, layout)
  const next = stepResidents(state, [event('note', { place_id: 3 }, 'from here')], 0, 100, layout)
  assert.equal(next.residents[7]!.placeId, 3)
  assert.equal(next.residents[7]!.bubble?.text, 'from here')
  assert.equal(next.residents[7]!.visible, false)
  assert.equal(next.issues.length, 1)
})

test('a nonquiet descendant of a quiet room remains hidden', () => {
  const nestedQuiet = { ...layout, rooms: {
    ...rooms,
    3: { ...rooms[3], children: [4] },
    4: { id: 4, parentId: 3, name: 'inner', quiet: false, depth: 2, x: 430, y: 300, width: 120, height: 90, door: { x: 490, y: 390 }, standing: { x: 440, y: 310, width: 90, height: 60 }, children: [] },
  } } as unknown as NestedLayout
  const state = createResidents(replay({ 'resident:7': { origin_event_id: 1, place_id: 4 } }), census, nestedQuiet)
  assert.equal(state.residents[7]!.visible, false)
})

test('a note naming a missing room is suppressed and preserves the last position', () => {
  const state = createResidents(replay(), census, layout)
  const before = state.residents[7]!
  const next = stepResidents(state, [event('note', { place_id: 999 }, 'wrong room')], 0, 100, layout)
  assert.equal(next.residents[7]!.placeId, before.placeId)
  assert.deepEqual([next.residents[7]!.x, next.residents[7]!.y], [before.x, before.y])
  assert.equal(next.residents[7]!.bubble, null)
  assert.deepEqual(next.issues, ['Some recorded events name a room the map does not show; those are not drawn.'])
})

test('noop, null endpoints, and unknown actors preserve positions and report mapping issues', () => {
  const state = createResidents(replay(), census, layout)
  const x = state.residents[7]!.x
  const bad = { ...event('action', { action: 'move', status: 'noop', from_place_id: 2, to_place_id: 3 }), actor: 'missing' }
  const next = stepResidents(state, [bad, event('action', { action: 'move', status: 'applied', from_place_id: 2 })], 100, 100, layout)
  assert.equal(next.residents[7]!.x, x)
  assert.deepEqual(next.issues, ['Some recorded events name residents the resident list does not know; they are not drawn.'])
})

test('expired bubble releases the next queued note and state remains immutable', () => {
  const state = createResidents(replay(), census, layout)
  const one = event('note', { place_id: 2 }, 'one')
  const two = { ...event('note', { place_id: 2 }, 'two'), event_id: 2 }
  const first = stepResidents(state, [one, two], 0, 1_000, layout)
  const second = stepResidents(first, [], 0, 5_999, layout)
  const third = stepResidents(second, [], 0, 6_000, layout)
  assert.equal(first.residents[7]!.bubble?.text, 'one')
  assert.equal(second.residents[7]!.bubble?.text, 'one')
  assert.equal(third.residents[7]!.bubble?.text, 'two')
  assert.equal(state.residents[7]!.bubble, null)
})

test('a lone held speech card does not block a later resident change', () => {
  let state = createResidents(replay(), census, layout)
  const longCard = event('note', { place_id: 2 }, 'A long card remains visible while the live feed advances.')
  state = stepResidents(state, [longCard], 0, 1_000, layout)
  assert.equal(state.residents[7]!.queue.length, 0)
  assert.equal(state.pending, true)
  assert.equal(blocksLiveDelivery(state), false)

  const laterChange = { ...event('action', { action: 'use', status: 'noop', place_id: 2 }), actor: 'still', change_id: '3', event_id: 3 }
  let queued: readonly ReplayEvent[] = [laterChange]
  const delivered: string[] = []
  if (!blocksLiveDelivery(state)) {
    const incoming = queued
    queued = []
    delivered.push(...incoming.map(row => row.change_id))
    state = stepResidents(state, incoming, 0, 2_000, layout)
  }
  if (!blocksLiveDelivery(state) && queued.length) delivered.push(...queued.map(row => row.change_id))

  assert.equal(state.residents[7]!.bubble?.text, longCard.line)
  assert.equal(state.residents[8]!.lastActivityId, '3')
  assert.deepEqual(state.startedEvents?.map(row => row.change_id), ['3'])
  assert.deepEqual(delivered, ['3'])
})

test('a queued earlier note holds the next live batch until it appears in recorded order', () => {
  const first = event('note', { place_id: 2 }, 'first card')
  const earlier = { ...event('note', { place_id: 2 }, 'earlier queued note'), change_id: '2', event_id: 2 }
  const later = { ...event('note', { place_id: 2 }, 'later other resident'), actor: 'still', change_id: '3', event_id: 3 }
  const holding = stepResidents(createResidents(replay(), census, layout), [first, earlier], 0, 1_000, layout)
  assert.equal(holding.residents[7]!.bubble?.text, first.line)
  assert.equal(holding.residents[7]!.queue[0]?.event.change_id, '2')
  assert.equal(holding.residents[8]!.bubble, null)
  assert.equal(blocksLiveDelivery(holding), true)

  const released = stepResidents(holding, [], 0, holding.residents[7]!.bubble!.expiresAt, layout)
  assert.equal(released.residents[7]!.bubble?.text, earlier.line)
  assert.equal(released.residents[7]!.queue.length, 0)
  assert.equal(blocksLiveDelivery(released), false)
  const delivered = stepResidents(released, [later], 0, released.residents[7]!.bubble!.startedAt + 1, layout)
  assert.equal(delivered.residents[7]!.bubble?.text, earlier.line)
  assert.equal(delivered.residents[8]!.bubble, null)
  assert.equal(delivered.residents[8]!.queue[0]?.event.change_id, '3')
  assert.equal(blocksLiveDelivery(delivered), true)
  const finished = stepResidents(delivered, [], 0, delivered.residents[7]!.bubble!.expiresAt, layout)
  assert.equal(finished.residents[8]!.bubble?.text, later.line)
  assert.deepEqual([...released.startedEvents!, ...delivered.startedEvents!, ...finished.startedEvents!]
    .map(row => row.change_id), ['2', '3'])
  assert.equal(holding.residents[7]!.queue.length, 1)
})

test('active walks and effects still block live delivery', () => {
  let state = createResidents(replay(), census, layout)
  state = stepResidents(state, [
    event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 1 }),
    { ...event('note', { place_id: 1 }, 'after walking'), change_id: '2', event_id: 2 },
  ], 0, 1_000, layout)
  assert.equal(blocksLiveDelivery(state), true)

  const inventing = stepResidents(createResidents(replay(), census, layout), [
    event('kind_invented', { kind_id: 10, name: 'lamp moss' }),
  ], 0, 1_000, layout)
  assert.equal(blocksLiveDelivery(inventing), true)
})

test('real replay finishes with every mapped resident in its last valid recorded room', () => {
  const realReplay = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
  const census = ['page1', 'page2'].flatMap(page =>
    (JSON.parse(readFileSync(new URL(`./fixtures/residents-presence-${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)
  const realLayout = nestedLayout(realReplay.map.places, roomCapacity(realReplay, census))
  let state = createResidents(realReplay, census, realLayout)
  const expected = new Map(Object.values(state.residents).map(resident => [resident.id, resident.placeId]))
  let now = 0
  for (const item of realReplay.timeline) {
    const id = typeof item.actor === 'string' ? state.actors.get(item.actor) : undefined
    const from = item.detail.from_place_id
    const to = item.detail.to_place_id
    if (id !== undefined && item.kind === 'action' && item.detail.status === 'applied' &&
        (item.detail.action === 'move' || item.detail.action === 'go_home') &&
        typeof from === 'number' && typeof to === 'number' && item.detail.error == null && realLayout.rooms[from] && realLayout.rooms[to]) expected.set(id, to)
    if (id !== undefined && item.kind === 'note' && typeof item.detail.place_id === 'number' && realLayout.rooms[item.detail.place_id]) expected.set(id, item.detail.place_id)
    state = stepResidents(state, [item], 0, now, realLayout)
    for (let guard = 0; state.pending && guard < 12; guard += 1) {
      now += 1_000
      state = stepResidents(state, [], 1_000, now, realLayout)
    }
  }
  for (const [id, placeId] of expected) assert.equal(state.residents[id]!.placeId, placeId, `resident ${String(id)}: ${state.issues.join(' ')}`)
})

test('the two saved census pages name every actor the saved replay records', () => {
  const realReplay = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
  const census = ['page1', 'page2'].flatMap(page =>
    (JSON.parse(readFileSync(new URL(`./fixtures/residents-presence-${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)
  const realLayout = nestedLayout(realReplay.map.places, roomCapacity(realReplay, census))
  const state = createResidents(realReplay, census, realLayout)
  const actors = new Set(realReplay.timeline.map(item => item.actor).filter((actor): actor is string => typeof actor === 'string' && actor.length > 0))
  const unresolved = [...actors].filter(actor => state.actors.get(actor) === undefined)
  assert.deepEqual(unresolved, [])
  const startIds = Object.keys(realReplay.start).flatMap(key => {
    const match = /^resident:(\d+)$/.exec(key)
    return match ? [Number(match[1])] : []
  })
  assert.deepEqual(startIds.filter(id => !census.some(resident => resident.id === id)), [])
})

test('a noop move anchors a first placement quietly and reports only a real skipped route', () => {
  const anchor = event('action', { action: 'move', status: 'noop', from_place_id: 2, to_place_id: 2 })
  const absent = createResidents({ ...replay({}), timeline: [anchor] }, census, layout)
  assert.equal(absent.residents[7]!.placeId, null)
  const placed = stepResidents(absent, [anchor], 16, 16, layout)
  assert.equal(placed.residents[7]!.placeId, 2)
  assert.equal(placed.residents[7]!.walking, false)
  assert.deepEqual(placed.issues, [])

  const elsewhere = event('action', { action: 'move', status: 'noop', from_place_id: 1, to_place_id: 1 })
  const moved = stepResidents(placed, [elsewhere], 16, 32, layout)
  assert.equal(moved.residents[7]!.placeId, 1)
  assert.equal(moved.residents[7]!.walking, false)
  assert.deepEqual(moved.issues, ['The record skips part of some routes; those figures reappear at their next recorded room.'])
})

const threeCensus: readonly Resident[] = [
  { id: 7, handle: 'walker', current_place_id: 2, model: '', joined_at: '', has_drawing: false, asleep: false },
  { id: 8, handle: 'still', current_place_id: 2, model: '', joined_at: '', has_drawing: false, asleep: false },
  { id: 9, handle: 'other', current_place_id: 1, model: '', joined_at: '', has_drawing: false, asleep: false },
]
const threeStart = {
  'resident:7': { origin_event_id: 1, place_id: 2 },
  'resident:8': { origin_event_id: 1, place_id: 2 },
  'resident:9': { origin_event_id: 1, place_id: 1 },
}
const walkAway = event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 })
const callOther = { ...event('note', { place_id: 2 }, 'over here'), actor: 'other' }

test('a figure walking out of a room no longer holds a spot in it', () => {
  const oneResidentFloor = ROOM_RESIDENT_SIZE + 16 * 2
  const oneSpot = { ...layout, rooms: { ...rooms, 2: { ...rooms[2],
    standing: { x: 420, y: 20, width: oneResidentFloor, height: oneResidentFloor } } } } as unknown as NestedLayout
  const aloneStart = {
    'resident:7': { origin_event_id: 1, place_id: 2 },
    'resident:8': { origin_event_id: 1, place_id: 1 },
    'resident:9': { origin_event_id: 1, place_id: 1 },
  }
  const state = createResidents({ ...replay(aloneStart), timeline: [] }, threeCensus, oneSpot)
  const vacated = state.residents[7]!
  const next = stepResidents(state, [walkAway, callOther], 0, 0, oneSpot)

  assert.equal(next.residents[7]!.walking, true)
  assert.equal(next.residents[9]!.placeId, 2)
  assert.deepEqual([next.residents[9]!.x, next.residents[9]!.y], [vacated.x, vacated.y])
  // Only the honest gap in the record is reported; the room was not called full.
  assert.deepEqual(next.issues, ['The record skips part of some routes; those figures reappear at their next recorded room.'])
})

test('the same events at two frame rates end on the same standing spots', () => {
  const settled = (deltaMs: number): Record<number, { placeId: number | null; x: number; y: number }> => {
    let state = createResidents({ ...replay(threeStart), timeline: [] }, threeCensus, layout)
    let now = 0
    state = stepResidents(state, [walkAway], 0, now, layout)
    let called = false
    for (let frame = 0; frame < 4_000 && (state.pending || !called); frame += 1) {
      now += deltaMs
      const due = !called && now >= 600 ? [callOther] : []
      if (due.length) called = true
      state = stepResidents(state, due, deltaMs, now, layout)
    }
    return Object.fromEntries(Object.values(state.residents)
      .map(resident => [resident.id, { placeId: resident.placeId, x: resident.x, y: resident.y }]))
  }

  const fine = settled(16)
  assert.equal(fine[9]!.placeId, 2)
  assert.equal(fine[7]!.placeId, 3)
  assert.deepEqual(fine, settled(100))
  assert.deepEqual(fine, settled(50))
})

test('a faster chosen speed settles the same events in less time', () => {
  const settleMs = (speed: number): number => {
    let state = createResidents(replay(), census, layout)
    let now = 0
    state = stepResidents(state, [
      event('action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 }),
      event('note', { place_id: 3 }, 'arrived'),
    ], 0, now, layout, speed)
    for (let frame = 0; frame < 20_000 && state.pending; frame += 1) {
      now += 16
      state = stepResidents(state, [], 16, now, layout, speed)
    }
    return now
  }

  assert.ok(settleMs(300) < settleMs(120))
  assert.ok(settleMs(120) < settleMs(60))
})
