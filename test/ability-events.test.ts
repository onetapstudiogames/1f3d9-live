import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { activityEntry, activityReduce, emptyActivity, knownActivityKind, type ActivityContext, type ActivityPlace } from '../src/activity.ts'
import { chanceRollWords, copyLine, roomSettleWords, thingEditWords, unknownKindWords } from '../src/ability-events.ts'
import { fetchPlaceOutline } from '../src/city/api.ts'
import { parseChangesPage } from '../src/city/changes.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import { witnessedEvents } from '../src/current-state.ts'
import { ROUGH_ROOM_LINE, roomMark } from '../src/live-presentation.ts'

// Built from the rows the city's own tests record (city PRs #359 and #360), cut to the
// reference fields /api/changes keeps. Not a recorded live page; replace once the city ships.
const saved = await readFile(new URL('./fixtures/changes-abilities.json', import.meta.url), 'utf8')
const page = parseChangesPage(JSON.parse(saved))

const places = new Map<number, ActivityPlace>([
  [1, { id: 1, name: 'the world', parentId: null, quiet: false, hasDrawing: false }],
  [3, { id: 3, name: 'the square', parentId: 1, quiet: false, hasDrawing: false }],
  [5, { id: 5, name: 'the quiet house', parentId: 1, quiet: true, hasDrawing: false }],
] as const)
const context: ActivityContext = {
  resident: actor => actor === 'northstar' ? { type: 'resident', id: 257, name: 'northstar', hasDrawing: false } : null,
  place: id => places.get(id) ?? null,
  roomName: id => places.get(id)?.name ?? null,
}
const row = (changeId: number, kind: string, detail: ReplayEvent['detail']): ReplayEvent => ({
  actor: 'northstar', at: new Date(changeId * 1_000).toISOString(), change_id: String(changeId), event_id: changeId, kind, detail,
})

test('the saved ability rows are in the public feed shape and served identically to the browser checks', async () => {
  assert.equal(saved, await readFile(new URL('../public/fixtures/changes-abilities.json', import.meta.url), 'utf8'))
  assert.deepEqual(page.events.map(event => event.kind), ['chance_rolled', 'chance_rolled', 'chance_rolled', 'room_settled',
    'room_settled', 'thing_edited', 'thing_created', 'thing_edited', 'weather_turned'])
  // The feed keeps only reference fields; roll numbers, try counts, and state values never arrive.
  for (const event of page.events) {
    for (const hidden of ['roll', 'percent', 'roll_id', 'settle_id', 'tried', 'woke', 'forfeited', 'budget', 'key', 'op', 'version']) {
      assert.equal(hidden in event.detail, false, `${event.kind} ${hidden}`)
    }
  }
})

test('every ability row becomes one short plain room-log line in its room', () => {
  const state = activityReduce(emptyActivity(), page.events, Date.parse('2026-09-08T00:00:00Z'), context)
  assert.deepEqual(state.entries.map(entry => [entry.roomId, entry.text]), [
    [3, 'northstar rolled a public chance with thing #2557; it hit.'],
    [3, 'northstar rolled a public chance with thing #2557; it missed.'],
    [3, 'northstar set off a public roll that picked which things wake in the square.'],
    [3, 'northstar arrived and things woke in the square.'],
    [3, 'northstar checked in; the square settled and nothing woke.'],
    [3, 'northstar changed the state box of thing #2557.'],
    [3, "northstar's thing made a copy: a gift for whoever comes next."],
    [3, 'northstar turned thing #2557 into another kind.'],
    [3, 'northstar left a public record (weather turned).'],
  ])
  for (const entry of state.entries) {
    assert.doesNotMatch(entry.text, /error|failed|refused|undefined|null|NaN/i)
    assert.equal(entry.actorResidentId, 257)
  }
  assert.equal(state.entries[6]!.kind, 'thing-made')
  assert.equal(state.entries[6]!.thingId, 2701)
})

test('a known thing name replaces its number, and a copy of itself says so', () => {
  const named: ActivityContext = { ...context, thing: id => id === 2557
    ? { entity: { type: 'thing', id, name: 'a brass bell', hasDrawing: null }, placeId: 3 } : null }
  assert.equal(activityEntry(row(1, 'chance_rolled', { thing_id: 2557, place_id: 3, status: 'then' }), named)?.text,
    'northstar rolled a public chance with a brass bell; it hit.')
  assert.equal(activityEntry(row(2, 'thing_created', { thing_id: 9, place_id: 3, name: 'a brass bell', mode: 'copy', source_thing_id: 2557 }), named)?.text,
    "northstar's a brass bell made a copy of itself.")
  assert.equal(activityEntry(row(3, 'thing_created', { thing_id: 9, place_id: 3, name: 'a small bell', mode: 'copy', source_thing_id: 2557 }), named)?.text,
    "northstar's a brass bell made a copy: a small bell.")
  assert.equal(activityEntry(row(4, 'thing_edited', { thing_id: 2557, place_id: 3, mode: 'converted', kind_id: 4 }), named)?.text,
    'northstar turned a brass bell into another kind.')
})

test('ability rows in a quiet room or an unknown room stay out of the log', () => {
  for (const kind of ['chance_rolled', 'room_settled', 'weather_turned']) {
    assert.equal(activityEntry(row(1, kind, { place_id: 5, mode: 'arrive', status: 'woke' }), context), null, kind)
    assert.equal(activityEntry(row(2, kind, { place_id: 99, mode: 'arrive', status: 'woke' }), context), null, kind)
  }
  assert.equal(activityEntry(row(3, 'thing_edited', { thing_id: 7, place_id: 5, mode: 'state' }), context), null)
  assert.equal(activityEntry(row(4, 'thing_created', { thing_id: 7, place_id: 5, name: 'seed', mode: 'copy' }), context), null)
  // A settle and a roll name their room; without one there is nothing to place.
  assert.equal(activityEntry(row(5, 'room_settled', { mode: 'arrive', status: 'woke' }), context), null)
  assert.equal(activityEntry(row(6, 'chance_rolled', { thing_id: 7, status: 'then' }), context), null)
})

test('an unknown kind is never dropped in silence: it takes its room, or where its actor stands', () => {
  const placed = activityEntry(row(1, 'dream_woven', { place_id: 3 }), context)!
  assert.equal(placed.text, 'northstar left a public record (dream woven).')
  assert.equal(placed.roomId, 3)
  const standing = activityEntry(row(2, 'dream_woven', {}), { ...context, actorRoom: () => 3 })!
  assert.equal(standing.roomId, null)
  assert.equal(standing.anchorRoomId, 3)
  assert.equal(activityEntry(row(3, 'dream_woven', { error: 'engine words' }), context)?.text, 'northstar left a public record (dream woven).')
  assert.equal(activityEntry(row(4, 'x<y>', {}), context)?.text, 'northstar left a public record.')
  // Hidden placement still hides it.
  assert.equal(activityEntry(row(5, 'dream_woven', {}), { ...context, placementVisibility: () => 'hidden' }), null)
  assert.deepEqual(witnessedEvents([row(6, 'dream_woven', {})], { ...context, actorRoom: () => 3 }, 3).map(event => event.change_id), ['6'])
  assert.deepEqual(witnessedEvents([row(7, 'dream_woven', {})], { ...context, actorRoom: () => 1 }, 3), [])
  assert.equal(knownActivityKind('dream_woven'), false)
  for (const kind of ['action', 'note', 'chance_rolled', 'room_settled', 'thing_edited', 'thing_created']) assert.equal(knownActivityKind(kind), true)
})

test('the word helpers never claim what the feed did not carry', () => {
  assert.equal(chanceRollWords({ status: 'then' }, '', null), 'rolled a public chance; it hit')
  assert.equal(chanceRollWords({ status: null }, '', null), 'set off a public roll that picked which things wake')
  assert.equal(chanceRollWords({ status: 'sideways' }, 'a die', 'x'), 'rolled a public chance with a die')
  assert.equal(roomSettleWords({ mode: 'talk', status: 'woke' }, 'the square'), 'spoke and things woke in the square')
  assert.equal(roomSettleWords({ mode: 'act', status: 'quiet' }, 'the square'), 'acted; the square settled and nothing woke')
  assert.equal(roomSettleWords({ mode: 'later', status: 'woke' }, 'the square'), 'was there and things woke in the square')
  assert.equal(thingEditWords('state', 'a box'), 'changed the state box of a box')
  assert.equal(thingEditWords(undefined, 'a box'), null)
  assert.equal(activityEntry(row(1, 'thing_edited', { thing_id: 4, place_id: 3 }), context)?.text, 'northstar changed thing #4.')
  assert.equal(copyLine('a', 'seed', null), "a's thing made a copy: seed.")
  assert.equal(unknownKindWords('  '), 'left a public record')
})

test('a rough room is marked only when its place read says rough_room true', async t => {
  assert.equal(roomMark(undefined), null)
  assert.equal(roomMark(false), null)
  assert.deepEqual(roomMark(true), { text: 'rough room', title: ROUGH_ROOM_LINE })
  assert.match(ROUGH_ROOM_LINE, /Going home is never blocked\.$/)
  const original = globalThis.fetch
  let rough: unknown = true
  globalThis.fetch = async () => Response.json({ place: { id: 3, name: 'the square', parent_id: 2, owner: 'founder', owner_id: 1,
    quiet: false, rough_room: rough }, things: [], things_page: { total_items: 0, returned_items: 0, has_more: false, next_before_thing_id: null } })
  t.after(() => { globalThis.fetch = original })
  assert.equal((await fetchPlaceOutline(3, '?places=/fixtures/places'))?.roughRoom, true)
  for (const value of [false, 'true', undefined]) {
    rough = value
    assert.equal((await fetchPlaceOutline(3, '?places=/fixtures/places'))?.roughRoom, undefined, String(value))
  }
})
