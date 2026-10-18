import assert from 'node:assert/strict'
import test from 'node:test'
import { readBrowserMutes, type BrowserMute } from '../src/browser-mutes.ts'
import { thingIds } from '../src/city/api.ts'
import type { ReplayEvent, ReplayPlace, Resident } from '../src/city/types.ts'
import { eventSubject, hiddenResidents, LiveMutes, thingSubject } from '../src/live-mutes.ts'
import { hiddenInRoom, MUTE_COUNT_WORDS, muteStatus, roomDrawingHidden, statusWithMutes } from '../src/mute-view.ts'
import { resolveRoomLink, parseRoomLink } from '../src/room-links.ts'
import { busiestRoom } from '../src/room-view.ts'

const place = (id: number, parent_id: number | null, quiet = false, name = `room ${String(id)}`): ReplayPlace => ({
  id, parent_id, quiet, name, owner: null, owner_id: null, has_drawing: false,
})
const resident = (id: number, placeId: number | null, asleep = false): Resident => ({
  id, handle: `resident-${String(id)}`, model: '', joined_at: '', has_drawing: true, current_place_id: placeId, asleep,
})
const event = (kind: string, detail: ReplayEvent['detail'], actor = 'resident-12'): ReplayEvent => ({
  actor, at: '2026-10-18T00:00:00.000Z', change_id: '1', event_id: 1, kind, detail,
})
const places = [place(2, null, false, 'first town'), place(3, 2, false, 'the square'), place(10, 2, false, 'the hive'),
  place(11, 10, false, 'the comb'), place(12, 10)]
const mute = (type: BrowserMute['type'], id: number, choice: BrowserMute['choice'] = 'mute'): BrowserMute => ({ type, id, choice })

test('an absent, blocked or unreadable list leaves every answer exactly as with no list', () => {
  const lists = [
    readBrowserMutes(() => { throw new Error('storage is unavailable') }),
    readBrowserMutes(() => ({ getItem: () => 'not json' })),
    readBrowserMutes(() => ({ getItem: () => '{"version":2,"items":[{"type":"resident","id":12,"choice":"mute"}]}' })),
    readBrowserMutes(() => ({ getItem: () => JSON.stringify({ version: 1,
      items: Array.from({ length: 1001 }, (_, index) => mute('resident', index + 2)) }) })),
  ]
  const none = new LiveMutes([])
  for (const list of lists) {
    const mutes = new LiveMutes(list)
    assert.equal(mutes.empty, true)
    assert.deepEqual([...mutes.rooms(places)], [...none.rooms(places)])
    assert.deepEqual([...mutes.residents()], [])
    assert.equal(mutes.thingHidden({ id: 9, placeId: 3 }, { makerId: 12, kindId: 39 }, places), false)
    assert.equal(mutes.eventHidden(event('note', { note_id: 5, place_id: 3 }), 12, null, places), false)
    assert.equal(mutes.lineHidden({ id: 9001, placeId: 3 }, 12, places), false)
  }
})

test('the scene mute list answers for rooms, residents, things, log lines and lines', () => {
  const mutes = new LiveMutes([mute('place', 10), mute('place', 11, 'allow'), mute('resident', 12), mute('kind', 39), mute('thing', 7)])
  assert.deepEqual([...mutes.rooms(places)].sort((left, right) => left - right), [10, 12])
  assert.equal(mutes.rooms(places), mutes.rooms(places), 'one place list is worked out once')
  assert.deepEqual([...mutes.residents()], [12])
  assert.equal(mutes.thingHidden({ id: 9, placeId: 3 }, { makerId: 8, kindId: 39 }, places), true)
  assert.equal(mutes.thingHidden({ id: 9, placeId: 3 }, { makerId: 8, ownerId: 1, kindId: 39 }, places), false)
  assert.equal(mutes.thingHidden({ id: 7, placeId: 3 }, undefined, places), true)
  assert.equal(mutes.thingHidden({ id: 8, placeId: 12 }, undefined, places), true)
  assert.equal(mutes.thingHidden({ id: 8, placeId: 11 }, undefined, places), false)
  assert.equal(mutes.eventHidden(event('action', { action: 'use', source_thing_id: 7, place_id: 3 }), 13, null, places), true)
  assert.equal(mutes.eventHidden(event('note', { note_id: 5, place_id: 3 }), 12, null, places), true)
  assert.equal(mutes.eventHidden(event('note', { note_id: 5, place_id: 3 }), 1, null, places), false)
  assert.equal(mutes.lineHidden({ id: 9001, placeId: 3 }, 12, places), true)
  assert.equal(mutes.lineHidden({ id: 9001, placeId: 3 }, 13, places), false)
})

test('a new list replaces the old one only when it differs', () => {
  const mutes = new LiveMutes([mute('resident', 12)])
  assert.equal(mutes.replace([mute('resident', 12)]), false)
  assert.equal(mutes.replace([mute('resident', 13)]), true)
  assert.deepEqual([...mutes.residents()], [13])
  assert.equal(mutes.replace([]), true)
  assert.equal(mutes.empty, true)
})

test('change rows and floor things become mute subjects without inventing facts', () => {
  assert.deepEqual(eventSubject(event('action', { action: 'use', source_thing_id: 7, place_id: 3 }), 12),
    { type: 'event', author_id: 12, note_id: null, thing_id: 7, kind_id: null, place_id: 3 })
  assert.deepEqual(eventSubject(event('kind_invented', { kind_id: 39, thing_id: 0 }), null),
    { type: 'event', author_id: null, note_id: null, thing_id: null, kind_id: 39, place_id: null })
  assert.deepEqual(thingSubject({ id: 9, placeId: 3 }, undefined),
    { type: 'thing', id: 9, author_id: null, owner_id: null, kind_id: null, place_id: 3 })
  assert.deepEqual(thingSubject({ id: 9, placeId: 3 }, { makerId: 8, ownerId: 1, kindId: 39 }),
    { type: 'thing', id: 9, author_id: 8, owner_id: 1, kind_id: 39, place_id: 3 })
})

test('thing rows give their numbered maker, current owner and kind only when they carry them', () => {
  assert.deepEqual(thingIds({ maker_id: 66, owner_id: 66, current_owner_id: 8, kind_id: 39 }), { makerId: 66, ownerId: 8, kindId: 39 })
  assert.deepEqual(thingIds({ maker_id: 66, owner_id: 5, kind_id: null }), { makerId: 66, ownerId: 5, kindId: null })
  assert.deepEqual(thingIds({ maker_id: '66', owner_id: 0 }), {})
  assert.deepEqual(thingIds({}), {})
})

test('the status counts what the list hid here, and says nothing when it hid nothing', () => {
  assert.equal(muteStatus(2), '2 hidden by your mutes in this browser.')
  assert.equal(muteStatus(1), '1 hidden by your mutes in this browser.')
  assert.equal(muteStatus(0), '')
  assert.equal(MUTE_COUNT_WORDS, 'hidden by your mutes in this browser')
})

test('the mute words join the status line but never cover a small window, a failed read or a quiet room', () => {
  const plain = { tooSmall: false, readFailed: false, quiet: false }
  assert.equal(statusWithMutes('', '1 hidden by your mutes in this browser.', plain), '1 hidden by your mutes in this browser.')
  assert.equal(statusWithMutes('Some things could not be read.', '1 hidden by your mutes in this browser.', plain),
    'Some things could not be read. 1 hidden by your mutes in this browser.')
  assert.equal(statusWithMutes('kept', '', plain), 'kept')
  for (const state of [{ ...plain, tooSmall: true }, { ...plain, readFailed: true }, { ...plain, quiet: true }]) {
    assert.equal(statusWithMutes('own sentence', '1 hidden by your mutes in this browser.', state), 'own sentence')
  }
})

test('the count covers residents and things in the shown room only', () => {
  const residents = [{ id: 12, placeId: 3 }, { id: 13, placeId: 3 }, { id: 12, placeId: 4 }, { id: 14, placeId: null }]
  const things = [{ id: 7, placeId: 3 }, { id: 8, placeId: 3 }, { id: 7, placeId: 4 }]
  const hidden = { resident: (id: number) => id === 12 || id === 14, thing: (thing: { id: number }) => thing.id === 7 }
  assert.equal(hiddenInRoom(3, residents, things, hidden), 2)
  assert.equal(hiddenInRoom(4, residents, things, hidden), 2)
  assert.equal(hiddenInRoom(5, residents, things, hidden), 0)
  assert.equal(hiddenInRoom(null, residents, things, hidden), 0)
  assert.equal(hiddenInRoom(3, residents, things, { ...hidden, drawing: true }), 3, 'a hidden room drawing counts once')
})

test('the opening room skips places the list hides, as it skips quiet ones', () => {
  const town = [place(1, null), place(2, 1), place(3, 1), place(4, 1, true)]
  const census = [resident(1, 2), resident(2, 2), resident(3, 3), resident(5, 4), resident(6, 4)]
  assert.equal(busiestRoom(town, census), 2)
  assert.equal(busiestRoom(town, census, new Set([2])), 3)
  assert.equal(busiestRoom(town, census, new Set([2, 3])), 1, 'a container whose leaves are all hidden can open')
  assert.equal(busiestRoom(town, census, new Set([1, 2, 3])), 2, 'when every public place is hidden, the usual choice stands')
  assert.equal(resolveRoomLink(parseRoomLink(''), town, census, new Set([2])).roomId, 3)
  // A link names its room on purpose; it opens there, drawn without what the list hides.
  assert.equal(resolveRoomLink(parseRoomLink('?place=2'), town, census, new Set([2])).roomId, 2)
  assert.equal(resolveRoomLink(parseRoomLink('?place=4'), town, census, new Set([2])).roomId, 3)
})

test('a muted place keeps the founder: only other residents standing in it are hidden', () => {
  const rules = new LiveMutes([mute('place', 3), mute('resident', 20)]).rules
  const rooms = new LiveMutes([mute('place', 3)]).rooms(places)
  const standing = [{ id: 1, placeId: 3 }, { id: 12, placeId: 3 }, { id: 13, placeId: 10 }, { id: 14, placeId: null }, { id: 20, placeId: 10 }]
  assert.deepEqual([...hiddenResidents(rules, rooms, standing)].sort((left, right) => left - right), [12, 20])
  const parent = new LiveMutes([mute('place', 2)])
  assert.deepEqual([...hiddenResidents(parent.rules, parent.rooms(places), standing)].sort((left, right) => left - right), [12, 13, 20])
  assert.deepEqual([...hiddenResidents(new LiveMutes([]).rules, new Set(), standing)], [])
})

test('a change row naming no place is judged where it arrives or where its actor stands', () => {
  assert.equal(eventSubject(event('move', { from_place_id: 10, to_place_id: 3 }), 12).place_id, 3)
  assert.equal(eventSubject(event('action', { action: 'make' }), 12, 10).place_id, 10)
  assert.equal(eventSubject(event('note', { note_id: 5, place_id: 3 }), 12, 10).place_id, 3)
  const mutes = new LiveMutes([mute('place', 3)])
  assert.equal(mutes.eventHidden(event('action', { action: 'make' }), 12, 3, places), true)
  assert.equal(mutes.eventHidden(event('action', { action: 'make' }), 1, 3, places), false, 'the founder is never hidden')
  assert.equal(mutes.eventHidden(event('move', { from_place_id: 3, to_place_id: 10 }), 12, 3, places), false)
})

test('a muted room keeps its drawing only when the founder owns it', () => {
  const mutes = new LiveMutes([mute('place', 2)])
  const rooms = mutes.rooms(places)
  const shown = (id: number, owner_id: number | null) => ({ id, owner_id, has_drawing: true })
  assert.equal(roomDrawingHidden(mutes.rules, rooms, shown(3, 1)), false)
  assert.equal(roomDrawingHidden(mutes.rules, rooms, shown(3, 12)), true)
  assert.equal(roomDrawingHidden(mutes.rules, rooms, shown(3, null)), true, 'an owner not yet read is not assumed to be the founder')
  assert.equal(roomDrawingHidden(mutes.rules, rooms, undefined), false)
  assert.equal(roomDrawingHidden(new LiveMutes([]).rules, new Set(), shown(3, 12)), false)
})
