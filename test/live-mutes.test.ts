import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActivityContext, ActivityEntry } from '../src/activity.ts'
import { readBrowserMutes, type BrowserMute } from '../src/browser-mutes.ts'
import { thingIds } from '../src/city/api.ts'
import type { ReplayEvent, ReplayPlace, Resident } from '../src/city/types.ts'
import { eventSubject, LiveMutes, thingSubject } from '../src/live-mutes.ts'
import { hiddenInRoom, MUTE_COUNT_WORDS, mutedRoom, muteStatus, statusWithMutes } from '../src/mute-view.ts'
import { resolveRoomLink, parseRoomLink } from '../src/room-links.ts'
import { busiestRoom } from '../src/room-view.ts'
import { RoomActivityLine } from '../src/scenes/RoomActivityLine.ts'

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
    assert.equal(mutes.eventHidden(event('note', { note_id: 5, place_id: 3 }), 12, places), false)
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
  assert.equal(mutes.eventHidden(event('action', { action: 'use', source_thing_id: 7, place_id: 3 }), 13, places), true)
  assert.equal(mutes.eventHidden(event('note', { note_id: 5, place_id: 3 }), 12, places), true)
  assert.equal(mutes.eventHidden(event('note', { note_id: 5, place_id: 3 }), 1, places), false)
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

test('the status names the hiding place, or counts what the list hid here', () => {
  const rules = new LiveMutes([mute('place', 10), mute('place', 11, 'allow')]).rules
  assert.deepEqual(mutedRoom(rules, places, 10), { name: 'the hive', self: true })
  assert.deepEqual(mutedRoom(rules, places, 12), { name: 'the hive', self: false })
  assert.equal(mutedRoom(rules, places, 11), null)
  assert.equal(mutedRoom(rules, places, 3), null)
  assert.equal(mutedRoom(rules, places, null), null)
  assert.deepEqual(mutedRoom(new LiveMutes([mute('place', 99)]).rules, places, 99), null)
  assert.equal(muteStatus({ room: { name: 'the hive', self: true }, hiddenCount: 0 }), 'This place is hidden by your mutes in this browser.')
  assert.equal(muteStatus({ room: { name: 'the hive', self: false }, hiddenCount: 4 }),
    'This place is inside the hive, which is hidden by your mutes in this browser.')
  assert.equal(muteStatus({ room: null, hiddenCount: 2 }), '2 hidden by your mutes in this browser.')
  assert.equal(muteStatus({ room: null, hiddenCount: 0 }), '')
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
})

test('the opening room skips places the list hides, as it skips quiet ones', () => {
  const town = [place(1, null), place(2, 1), place(3, 1), place(4, 1, true)]
  const census = [resident(1, 2), resident(2, 2), resident(3, 3), resident(5, 4), resident(6, 4)]
  assert.equal(busiestRoom(town, census), 2)
  assert.equal(busiestRoom(town, census, new Set([2])), 3)
  assert.equal(busiestRoom(town, census, new Set([2, 3])), 1, 'a container whose leaves are all hidden can open')
  assert.equal(busiestRoom(town, census, new Set([1, 2, 3])), 2, 'when every public place is hidden, the usual choice stands')
  assert.equal(resolveRoomLink(parseRoomLink(''), town, census, new Set([2])).roomId, 3)
  // A link names its room on purpose; it opens there and the status says the list hides it.
  assert.equal(resolveRoomLink(parseRoomLink('?place=2'), town, census, new Set([2])).roomId, 2)
  assert.equal(resolveRoomLink(parseRoomLink('?place=4'), town, census, new Set([2])).roomId, 3)
})

test('the room log keeps nothing for a room the list hides and starts blank when it shows again', () => {
  const context: ActivityContext = { resident: name => ({ type: 'resident', id: 12, name, hasDrawing: false }),
    place: id => ({ id, name: `room ${String(id)}`, parentId: null, quiet: false, hasDrawing: false }), roomName: id => `room ${String(id)}` }
  const entry = (key: string, roomId: number): ActivityEntry => Object.freeze({ key, changeId: Number(key), time: Number(key),
    kind: 'event', text: `event ${key}`, entities: Object.freeze([]), roomId })
  let hidden = new Set([3])
  const line = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(line, context, roomId => hidden.has(roomId))
  log.selectRoom(3)
  assert.deepEqual(log.appendEntries([entry('1', 3)]), [])
  assert.equal(line.textContent, '')
  hidden = new Set()
  log.selectRoom(3)
  assert.deepEqual(log.appendEntries([entry('2', 3)]).map(row => row.key), ['2'])
  assert.equal(line.textContent, 'event 2')
  hidden = new Set([3])
  log.selectRoom(3)
  assert.equal(line.textContent, '')
  const plain = new RoomActivityLine({ textContent: '' } as HTMLElement, context)
  plain.selectRoom(3)
  assert.deepEqual(plain.appendEntries([entry('3', 3)]).map(row => row.key), ['3'], 'without a list the log is unchanged')
})
