import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { activityEntry, activityReduce, emptyActivity, knownActivityKind, type ActivityContext, type ActivityPlace } from '../src/activity.ts'
import { chanceRollWords, copyLine, copySkippedWords, roomReachedWords, roomSettleWords, thingEditWords, unknownKindWords } from '../src/ability-events.ts'
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
    [3, 'northstar turned thing #2557 into kind #91.'],
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
    "northstar's a brass bell copied itself.")
  assert.equal(activityEntry(row(3, 'thing_created', { thing_id: 9, place_id: 3, name: 'a small bell', mode: 'copy', source_thing_id: 2557 }), named)?.text,
    "northstar's a brass bell made a copy: a small bell.")
  assert.equal(activityEntry(row(4, 'thing_edited', { thing_id: 2557, place_id: 3, mode: 'converted', kind_id: 4 }), named)?.text,
    'northstar turned a brass bell into kind #4.')
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
  for (const kind of ['action', 'note', 'chance_rolled', 'room_settled', 'room_reached', 'copy_skipped', 'thing_edited', 'thing_created']) assert.equal(knownActivityKind(kind), true)
})

test('the word helpers never claim what the feed did not carry', () => {
  assert.equal(chanceRollWords({ status: 'then' }, '', null), 'rolled a public chance; it hit')
  assert.equal(chanceRollWords({ status: null }, '', null), 'set off a public roll that picked which things wake')
  assert.equal(chanceRollWords({ status: 'sideways' }, 'a die', 'x'), 'rolled a public chance with a die')
  assert.equal(roomSettleWords({ mode: 'talk', status: 'woke' }, 'the square'), 'spoke and things woke in the square')
  assert.equal(roomSettleWords({ mode: 'act', status: 'quiet' }, 'the square'), 'acted; the square settled and nothing woke')
  assert.equal(roomSettleWords({ mode: 'later', status: 'woke' }, 'the square'), 'was there and things woke in the square')
  assert.equal(thingEditWords({ mode: 'state' }, 'a box'), 'changed the state box of a box')
  assert.equal(thingEditWords({}, 'a box'), null)
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

// Built from the rows city PR #368's own integration test records
// (test/integration/public-feed-details-postgres.test.ts), with this page's room and thing
// numbers. Not a recorded live page; replace once the city ships PR #368.
const detailsSaved = await readFile(new URL('./fixtures/changes-abilities-details.json', import.meta.url), 'utf8')
const detailsPage = parseChangesPage(JSON.parse(detailsSaved))

test('the saved ability rows with numbers are in the city PR #368 feed shape and served identically', async () => {
  assert.equal(detailsSaved, await readFile(new URL('../public/fixtures/changes-abilities-details.json', import.meta.url), 'utf8'))
  // Exactly the fields the city lists for each kind, beside the shared reference fields.
  const kindFields: Record<string, readonly string[]> = {
    chance_rolled: ['roll_id', 'purpose', 'roll', 'sides', 'percent', 'outcome', 'settle_id', 'thing_id', 'place_id', 'action_id', 'status'],
    room_settled: ['settle_id', 'tried', 'woke', 'forfeited', 'place_id', 'mode', 'status'],
    room_reached: ['over', 'reached', 'more', 'skipped', 'stopped', 'settle_id', 'thing_id', 'trait_id', 'place_id', 'action_id'],
    copy_skipped: ['family_id', 'cap', 'limit', 'over_by', 'settle_id', 'thing_id', 'trait_id', 'place_id', 'action_id'],
    thing_created: ['generation', 'family_id', 'thing_id', 'place_id', 'name', 'kind_id', 'mode', 'source_thing_id'],
    thing_edited: ['version', 'key', 'op', 'from_kind_id', 'law_trait_id', 'thing_id', 'place_id', 'mode', 'source_thing_id', 'kind_id'],
  }
  for (const event of detailsPage.events) {
    const allowed = kindFields[event.kind]; if (!allowed) continue
    for (const field of Object.keys(event.detail)) assert.ok(allowed.includes(field), `${event.kind} ${field}`)
    // Never the day secret's fingerprint, the budget, or the trim count.
    for (const hidden of ['day', 'commitment', 'budget', 'trimmed']) assert.equal(hidden in event.detail, false)
  }
})

test('ability rows with numbers say them in plain words', () => {
  const names: Record<number, string> = { 2557: 'a coin', 2600: 'moss', 2602: 'a cloud', 2603: 'an open oak' }
  const named: ActivityContext = { ...context, thing: id => names[id]
    ? { entity: { type: 'thing', id, name: names[id]!, hasDrawing: null }, placeId: 3 } : null }
  const state = activityReduce(emptyActivity(), detailsPage.events, Date.parse('2026-09-08T00:00:00Z'), named)
  assert.deepEqual(state.entries.map(entry => [entry.roomId, entry.text]), [
    [3, 'northstar rolled 37 of 100 with a coin, a 50 percent chance, hit.'],
    [3, 'northstar rolled 81 of 100 with a coin, a 50 percent chance, missed; the action failed, so it did not count.'],
    [3, 'northstar rolled 3 of 8 to pick which things wake in the square.'],
    [3, 'northstar arrived and things woke in the square: 8 tried, 8 woke.'],
    [3, 'northstar added to guests in the state box of a coin, version 12.'],
    [3, 'northstar cleared the state box of a coin, version 13.'],
    [3, "northstar's moss copied itself, generation 2."],
    [3, 'northstar had a copy of moss refused: room daily limit 3, over by 1.'],
    [3, 'northstar set off a reach from a cloud in the square: reached 8 things, 1 refused.'],
    [3, "northstar set off a reach from the room's law in the square: reached 1 resident, 2 more left out; the action's reach limit stopped it."],
    [3, 'northstar turned an open oak from kind #66 into kind #67 by a law.'],
    [3, 'northstar left a public record (weather turned).'],
  ])
  for (const entry of state.entries) assert.doesNotMatch(entry.text, /undefined|null|NaN|\[object/i)
})

test('a number the row does not carry, or carries in the wrong shape, is never shown', () => {
  assert.equal(chanceRollWords({ status: 'then', roll: 37 }, 'a coin', 'x'), 'rolled a public chance with a coin; it hit')
  assert.equal(chanceRollWords({ status: 'then', roll: '37', sides: 100 }, 'a coin', 'x'), 'rolled a public chance with a coin; it hit')
  assert.equal(chanceRollWords({ status: 'else', roll: 5, sides: 6, percent: 250, outcome: 'counted' }, '', null), 'rolled 5 of 6, missed')
  assert.equal(chanceRollWords({ purpose: 'copy_place', roll: 2, sides: 3, status: null }, 'moss', 'x'), 'rolled 2 of 3 to pick where a copy of moss lands')
  assert.equal(chanceRollWords({ status: 'then', outcome: 'member_refused' }, 'a die', 'x'),
    'rolled a public chance with a die; it hit; the thing it reached refused, so it did not count')
  assert.equal(roomSettleWords({ mode: 'me', status: 'quiet', tried: 3, woke: 0, forfeited: 2 }, 'the square'),
    'checked in; the square settled and nothing woke: 3 tried, 0 woke, 2 dropped')
  assert.equal(roomSettleWords({ mode: 'me', status: 'quiet', tried: 3 }, 'the square'), 'checked in; the square settled and nothing woke')
  assert.equal(thingEditWords({ mode: 'state', key: 'Bad Key!', op: 'set', version: 4 }, 'a box'), 'changed the state box of a box, version 4')
  assert.equal(thingEditWords({ mode: 'state', key: 'mood', op: 'twist' }, 'a box'), 'wrote mood in the state box of a box')
  assert.equal(thingEditWords({ mode: 'converted', kind_id: 67, law_trait_id: null }, 'a box'), 'turned a box into kind #67')
  assert.equal(thingEditWords({ mode: 'converted', from_kind_id: 66, law_trait_id: 9 }, 'a box'), 'turned a box into another kind by a law')
  assert.equal(copyLine('a', 'seed', null, 0), "a's thing made a copy: seed.")
  assert.equal(copyLine('a', 'seed', 'moss', 3), "a's moss made a copy: seed, generation 3.")
  assert.equal(copySkippedWords({ cap: 'copies', limit: 1, over_by: 1 }, 'moss'), 'had a copy of moss refused: copy limit 1, over by 1')
  assert.equal(copySkippedWords({ cap: 'sideways', limit: 1 }, 'moss'), 'had a copy of moss stopped by a growth limit')
  assert.equal(copySkippedWords({ cap: 'generations' }, ''), 'had a copy refused: generation limit')
  assert.equal(roomReachedWords({ over: 'things', reached: 0, more: 0, skipped: 0, stopped: null }, 'a cloud', 'the square'),
    'set off a reach from a cloud in the square: reached 0 things')
  assert.equal(roomReachedWords({ over: 'people', reached: 4 }, 'a cloud', 'the square'), 'set off a reach from a cloud in the square')
})

test('the new kinds follow the room rules: a quiet or unknown room keeps them out', () => {
  for (const kind of ['room_reached', 'copy_skipped']) {
    assert.equal(activityEntry(row(1, kind, { thing_id: 7, place_id: 5, over: 'things', reached: 1 }), context), null, kind)
    assert.equal(activityEntry(row(2, kind, { thing_id: 7, place_id: 99, over: 'things', reached: 1 }), context), null, kind)
    assert.equal(activityEntry(row(3, kind, { thing_id: 7, over: 'things', reached: 1 }), context), null, kind)
  }
})
