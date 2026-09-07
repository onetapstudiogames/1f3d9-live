import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { CensusPage, ReplayEvent, ReplayFile, Resident } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { createResidents, roomCapacity, stepResidents } from '../src/replay/simulation.ts'
import { dueEvents, prepareTimeline } from '../src/replay/index.ts'

const joined = '2026-09-06T20:55:12.416Z'
const register: ReplayEvent = { actor: 'newcomer', at: joined, change_id: '1', event_id: 1, kind: 'register', detail: { resident_id: 7 } }
const places = [
  { id: 195, parent_id: null, name: 'the world', quiet: false, owner: null, owner_id: null, has_drawing: false },
  { id: 1, parent_id: 195, name: 'mainland', quiet: false, owner: null, owner_id: null, has_drawing: false },
]
const replay: ReplayFile = {
  span: '24h', window_start: '2026-09-06T20:00:00Z', window_end: '2026-09-07T02:00:00Z', checkpoint: '1',
  complete: true, row_ceiling: 800, map: { places }, start: { 'resident:7': { place_id: null } }, counts: {}, timeline: [register],
}
const census: readonly Resident[] = [{ id: 7, handle: 'newcomer', model: '', joined_at: joined, current_place_id: 1, asleep: false, has_drawing: false }]
const layout = nestedLayout(places, roomCapacity(replay, census))
const move = (from: number, to: number): ReplayEvent => ({ ...register, kind: 'action', event_id: 2, change_id: '2', detail: { action: 'move', status: 'applied', from_place_id: from, to_place_id: to } })

test('a register-only visitor reserves world capacity, once per resident even without the census', () => {
  assert.equal(roomCapacity(replay, census)[195], 1)
  assert.equal(roomCapacity({ ...replay, timeline: [register, register, move(195, 1)] }, [])[195], 1)
})

test('a padded registration actor still arrives and reserves world capacity once', () => {
  const padded = { ...register, actor: '  newcomer  ' }
  const data = { ...replay, timeline: [padded] }
  const ground = nestedLayout(places, roomCapacity(data, census))
  const arrival = stepResidents(createResidents(data, census, ground), [padded], 0, 100, ground)
  assert.equal(roomCapacity(data, census)[195], 1)
  assert.equal(arrival.residents[7]!.placeId, 195)
  assert.ok(arrival.residents[7]!.sparkle)
  assert.deepEqual(arrival.issues, [])
})

test('the figure appears only when the registration is due, then holds a fading sparkle before walking', () => {
  const state = createResidents(replay, census, layout)
  const timeline = prepareTimeline(replay.timeline)
  const before = dueEvents(timeline, 0, Date.parse(joined) - 1)
  const waiting = stepResidents(state, before.events, 0, 0, layout)
  assert.equal(waiting.residents[7]!.visible, false)
  assert.equal(waiting.residents[7]!.placeId, null)
  const due = dueEvents(timeline, before.cursor, Date.parse(joined))
  const arrival = stepResidents(waiting, [...due.events, move(195, 1)], 0, 100, layout)
  const newcomer = arrival.residents[7]!
  assert.equal(newcomer.visible, true)
  assert.equal(newcomer.placeId, 195)
  assert.equal(newcomer.y, layout.rooms[195]!.standing.y + 32)
  assert.equal(newcomer.walking, false)
  assert.equal(newcomer.joinedAt, joined)
  assert.equal(newcomer.sparkle?.shownAt, 100)
  assert.equal(arrival.pending, true)
  assert.equal(state.residents[7]!.placeId, null)
  const held = stepResidents(arrival, [], 0, newcomer.sparkle!.expiresAt - 1, layout)
  assert.equal(held.residents[7]!.walking, false)
  const walking = stepResidents(held, [], 0, newcomer.sparkle!.expiresAt, layout)
  assert.equal(walking.residents[7]!.sparkle, null)
  assert.equal(walking.residents[7]!.walking, true)
  assert.deepEqual(walking.residents[7]!.path[0], { x: newcomer.x, y: newcomer.y })
  assert.deepEqual(walking.issues, [])
})

test('the registration names a figure without the census but does not invent its census join date', () => {
  const state = createResidents(replay, [], layout)
  const arrived = stepResidents(state, [register], 0, 0, layout)
  assert.equal(arrived.residents[7]!.handle, 'newcomer')
  assert.equal(arrived.residents[7]!.visible, true)
  assert.equal(arrived.residents[7]!.joinedAt, null)
})

test('a first move from elsewhere uses that recorded source and the existing plain status', () => {
  const state = stepResidents(createResidents(replay, census, layout), [register], 0, 0, layout)
  const next = stepResidents(state, [move(1, 195)], 0, 10_000, layout)
  assert.equal(next.residents[7]!.placeId, 1)
  assert.equal(next.residents[7]!.walking, true)
  assert.deepEqual(next.issues, ['The record skips part of some routes; those figures reappear at their next recorded room.'])
})

test('repeat and malformed registrations cannot move or sparkle an existing figure', () => {
  const first = stepResidents(createResidents(replay, census, layout), [register], 0, 0, layout)
  const settled = stepResidents(first, [], 0, 10_000, layout)
  const repeated = stepResidents(settled, [register], 0, 11_000, layout)
  assert.equal(repeated.residents[7]!.sparkle, null)
  assert.deepEqual([repeated.residents[7]!.x, repeated.residents[7]!.y], [settled.residents[7]!.x, settled.residents[7]!.y])
  for (const invalid of [{ ...register, detail: { resident_id: 8 } }, { ...register, at: 'bad' }]) {
    const next = stepResidents(createResidents(replay, census, layout), [invalid], 0, 0, layout)
    assert.equal(next.residents[7]!.visible, false)
    assert.ok(next.issues.length)
  }
})

test('quiet worlds hide arrivals and a full edge keeps the figure unplaced with plain status', () => {
  const quiet = nestedLayout(places.map(place => ({ ...place, quiet: place.id === 195 })))
  const hidden = stepResidents(createResidents(replay, census, quiet), [register], 0, 0, quiet)
  assert.equal(hidden.residents[7]!.visible, false)
  const full = { ...layout, rooms: { ...layout.rooms, 195: { ...layout.rooms[195]!, standing: { x: 24, y: 24, width: 20, height: 20 } } } }
  const blocked = stepResidents(createResidents(replay, census, full), [register], 0, 0, full)
  assert.equal(blocked.residents[7]!.placeId, null)
  assert.equal(blocked.residents[7]!.sparkle, null)
  assert.deepEqual(blocked.issues, ['Some rooms had no free spot left, so those figures were not moved into them.'])
})

test('simultaneous newcomers avoid standing figures and reserved walk destinations, repeatably', () => {
  const second = { ...register, actor: 'second', detail: { resident_id: 8 } }
  const data = { ...replay, timeline: [register, second] }
  const people = [...census, { ...census[0]!, id: 8, handle: 'second' }]
  const initial = createResidents(data, people, layout)
  const once = stepResidents(initial, [register], 0, 0, layout)
  const first = once.residents[7]!
  const walking = { ...first, walking: true, placeId: 1, destinationId: 195, destination: { x: first.x, y: first.y }, x: -200, y: -200 }
  const reserved = { ...once, residents: { ...once.residents, 7: walking } }
  for (const before of [once, reserved]) {
    const after = stepResidents(before, [second], 0, 0, layout)
    assert.ok(Math.abs(after.residents[8]!.x - first.x) >= 48)
  }
  assert.deepEqual(stepResidents(initial, [register, second], 0, 0, layout), stepResidents(initial, [register, second], 0, 0, layout))
})

test('saved null register starts do not manufacture arrivals for residents who joined before the window', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
  const people = [1, 2].flatMap(n => (JSON.parse(readFileSync(new URL(`./fixtures/residents-presence-page${n}.json`, import.meta.url), 'utf8')) as CensusPage).residents)
  const ground = nestedLayout(data.map.places, roomCapacity(data, people))
  const initial = createResidents(data, people, ground)
  assert.equal(initial.residents[314]!.placeId, null)
  assert.equal(initial.residents[315]!.placeId, null)
  assert.equal(initial.residents[316]!.placeId, null)
  const arrival = stepResidents(initial, data.timeline.filter(row => row.kind === 'register'), 0, 0, ground)
  assert.equal(arrival.residents[316]!.placeId, 195)
  assert.equal(arrival.residents[314]!.placeId, null)
  assert.equal(arrival.residents[315]!.placeId, null)
})
