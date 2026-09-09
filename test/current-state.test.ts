import assert from 'node:assert/strict'
import test from 'node:test'
import { activityEntry, createActivityContext } from '../src/activity.ts'
import { refreshPresentResidents, witnessedEvents } from '../src/current-state.ts'
import type { ReplayEvent, ReplayPlace, Resident } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { createPresentResidents, prepareLiveResidents, stepResidents } from '../src/replay/simulation.ts'
import { presentRoom } from '../src/room-presentation.ts'
import { singleRoomLayout } from '../src/room-view.ts'

const places: readonly ReplayPlace[] = [
  { id: 1, name: 'world', parent_id: null, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 2, name: 'square', parent_id: 1, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 3, name: 'garden', parent_id: 1, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 4, name: 'quiet room', parent_id: 1, owner: null, owner_id: null, quiet: true, has_drawing: false },
]
const layout = nestedLayout(places, { 1: 2, 2: 2, 3: 2, 4: 2 })
const resident = (id: number, placeId: number | null, asleep = false): Resident => ({
  id, handle: `resident-${id}`, model: '', joined_at: '2026-01-01T00:00:00Z', has_drawing: false,
  current_place_id: placeId, asleep,
})

test('present residents come directly from the current census', () => {
  const state = createPresentResidents([resident(1, 2), resident(2, null)], layout)
  assert.equal(state.residents[1]!.placeId, 2)
  assert.equal(state.residents[1]!.visible, true)
  assert.equal(state.residents[2]!.placeId, null)
  assert.equal(state.actors.get('resident-1'), 1)
  assert.deepEqual(state.issues, [])
})

test('sleepers keep their room fact without taking an awake standing slot', () => {
  const sleepers = Array.from({ length: 12 }, (_, index) => resident(index + 1, 2, true))
  const awake = { ...resident(99, 2), handle: 'awake' }
  const state = createPresentResidents([...sleepers, awake], layout)
  assert.equal(state.residents[99]!.visible, true)
  assert.notEqual(state.residents[99]!.x, 0)
  for (const sleeper of sleepers) {
    assert.equal(state.residents[sleeper.id]!.placeId, 2)
    assert.equal(state.residents[sleeper.id]!.visible, false)
    assert.equal(state.residents[sleeper.id]!.x, 0)
  }
})

test('stale whole-city capacity does not hide current awake room residents', () => {
  const staleLayout = nestedLayout(places, { 1: 1, 2: 1, 3: 1, 4: 1 })
  const awake = Array.from({ length: 8 }, (_, index) => resident(index + 1, 2))
  const state = createPresentResidents(awake, staleLayout)
  assert.deepEqual(Object.values(state.residents).filter(row => row.visible).map(row => row.id), awake.map(row => row.id))
  for (const row of Object.values(state.residents)) {
    assert.equal(Number.isFinite(row.x) && Number.isFinite(row.y), true)
    assert.equal(row.placeId, 2)
  }
  const projected = presentRoom(state.residents, {}, staleLayout,
    singleRoomLayout(staleLayout.rooms[2]!, 1_200, 900), new Set())
  const seated = Object.values(projected.residents).filter(row => row.visible)
  assert.equal(seated.length, awake.length)
  for (let left = 0; left < seated.length; left += 1) for (let right = left + 1; right < seated.length; right += 1) {
    assert.equal(Math.abs(seated[left]!.x - seated[right]!.x) >= 56 || Math.abs(seated[left]!.y - seated[right]!.y) >= 56, true)
  }
})

test('refresh preserves a standing presentation in the same room and clears a sleeping card', () => {
  const initial = createPresentResidents([resident(1, 2)], layout)
  const old = initial.residents[1]!
  const presentation = Object.freeze({ ...old, x: old.x + 7,
    bubble: { text: 'hello', cut: false, placeId: 2, startedAt: 0, charInterval: 1, expiresAt: 99_999 },
    queue: [{ event: event('11', 'note', { note_id: 11, place_id: 2 }) }] })
  const state = Object.freeze({ ...initial, residents: Object.freeze({ 1: presentation }) })
  const awake = refreshPresentResidents(state, [resident(1, 2)], layout)
  assert.strictEqual(awake.state.residents[1], presentation)
  const asleep = refreshPresentResidents(state, [resident(1, 2, true)], layout, new Set([1]))
  assert.equal(asleep.state.residents[1]!.x, presentation.x)
  assert.equal(asleep.state.residents[1]!.bubble, null)
  assert.equal(asleep.state.residents[1]!.queue.length, 1)
})

test('refresh snaps census relocations cleanly while protected witnessed walks keep their destination', () => {
  const initial = createPresentResidents([resident(1, 2), resident(2, 2)], layout)
  const walking = Object.freeze({ ...initial.residents[2]!, walking: true, destinationId: 3,
    destination: { x: 10, y: 10 }, path: [{ x: 5, y: 5 }, { x: 10, y: 10 }], walkEventId: '20' })
  const state = Object.freeze({ ...initial, residents: Object.freeze({ ...initial.residents, 2: walking }) })
  const refreshed = refreshPresentResidents(state, [resident(1, 3), resident(2, 3), resident(3, 2)], layout, new Set([2]))
  assert.deepEqual([...refreshed.snappedIds], [1])
  assert.equal(refreshed.state.residents[1]!.placeId, 3)
  assert.equal(refreshed.state.residents[1]!.walking, false)
  assert.equal(refreshed.state.residents[1]!.bubble, null)
  assert.strictEqual(refreshed.state.residents[2], walking)
  assert.equal(refreshed.state.residents[3]!.placeId, 2)
})

test('refresh updates retained identity metadata and re-seats a resident who wakes', () => {
  const sleeping = createPresentResidents([resident(1, 2, true)], layout)
  const renamed = { ...resident(1, 2), handle: 'current-name', joined_at: '2026-02-02T00:00:00Z' }
  const refreshed = refreshPresentResidents(sleeping, [renamed], layout)
  assert.equal(refreshed.state.residents[1]!.handle, 'current-name')
  assert.equal(refreshed.state.residents[1]!.joinedAt, renamed.joined_at)
  assert.equal(refreshed.state.actors.get('current-name'), 1)
  assert.equal(refreshed.state.residents[1]!.visible, true)
  assert.notEqual(refreshed.state.residents[1]!.x, 0)
})

test('witnessed events require a proven public-room connection', () => {
  const census = [resident(1, 2)]
  const context = createActivityContext(census, places, place => place.name)
  const rows = [
    event('1', 'note', { note_id: 1, place_id: 2 }),
    event('2', 'note', { note_id: 2, place_id: 3 }),
    event('3', 'note', { note_id: 3, place_id: 4 }),
    event('4', 'action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 }),
    event('5', 'rotate', {}),
  ]
  assert.ok(activityEntry(rows[0]!, context))
  assert.deepEqual(witnessedEvents(rows, context, 2).map(row => row.change_id), ['1', '4'])
  assert.deepEqual(witnessedEvents(rows, context, 3).map(row => row.change_id), ['2', '4'])
  assert.deepEqual(witnessedEvents(rows, context, 4), [])
})

test('witnessed events evolve actor room proof in recorded order', () => {
  const context = { ...createActivityContext([resident(1, 3)], places, place => place.name),
    actorRoom: () => 3 as number | null,
    placementVisibility: () => 'public' as const }
  const moveIn = event('10', 'action', { action: 'move', status: 'applied', from_place_id: 3, to_place_id: 2 })
  const inside = event('11', 'resident_edited', { resident_id: 1 })
  const moveOut = event('12', 'action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 })
  const outside = event('13', 'resident_edited', { resident_id: 1 })
  assert.deepEqual(witnessedEvents([moveIn, inside, moveOut, outside], context, 2).map(row => row.change_id),
    ['10', '11', '12'])
})

test('a typed registration supplies identity for its following raw note', () => {
  const context = createActivityContext([], places, place => place.name)
  const register = { ...event('20', 'register', { resident_id: 8, handle: 'new-one' }), actor: 'new-one' }
  const note = { ...event('21', 'note', { note_id: 21, place_id: 2 }), actor: 'new-one' }
  assert.deepEqual(witnessedEvents([register, note], context, 2).map(row => row.change_id), ['21'])
})

test('a resident registered after census can show their witnessed note without replaying an arrival', () => {
  const emptyContext = createActivityContext([], places, place => place.name)
  const register = { ...event('30', 'register', { resident_id: 8 }), actor: 'new-one' }
  const rawNote = { ...event('31', 'note', { note_id: 31, place_id: 2 }), actor: 'new-one' }
  const witnessed = witnessedEvents([register, rawNote], emptyContext, 2)
  assert.deepEqual(witnessed.map(row => row.change_id), ['31'])

  const prepared = prepareLiveResidents(createPresentResidents([], layout), [register, rawNote])
  assert.equal(prepared.actors.get('new-one'), 8)
  assert.equal(prepared.residents[8]!.placeId, null)
  const enriched = Object.freeze({ ...witnessed[0]!, line: 'hello after census', line_cut: false })
  const shown = stepResidents(prepared, [enriched], 1, 1_000, layout)
  assert.equal(shown.residents[8]!.bubble?.text, 'hello after census')
  assert.deepEqual(shown.startedEvents?.map(row => row.change_id), ['31'])

  const identity = Object.freeze({ type: 'resident' as const, id: 8, name: 'new-one', hasDrawing: null })
  const dynamicContext = Object.freeze({ ...emptyContext, resident: (actor: string) => actor === 'new-one' ? identity : null,
    residentById: (id: number) => id === 8 ? identity : null })
  assert.equal(activityEntry(enriched, dynamicContext)?.actorResidentId, 8)
})

function event(changeId: string, kind: string, detail: ReplayEvent['detail']): ReplayEvent {
  return { actor: 'resident-1', at: '2026-01-01T00:00:00Z', change_id: changeId,
    event_id: Number(changeId), kind, detail }
}
