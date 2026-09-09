import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayPlace, Resident } from '../src/city/types.ts'
import { parseRoomLink, resolveRoomLink, replaceRoomLink, type RoomLinkSelection } from '../src/room-links.ts'

const place = (id: number, parent_id: number | null, quiet = false): ReplayPlace => ({
  id, parent_id, quiet, name: `Room ${id}`, owner: null, owner_id: null, has_drawing: false,
})
const resident = (id: number, current_place_id: number | null, asleep = false): Resident => ({
  id, current_place_id, asleep, handle: `neighbor-${id}`, model: '', joined_at: '', has_drawing: false,
})
const places = [place(1, null), place(2, 1), place(3, 1), place(4, 1, true), place(5, 4),
  place(6, 99), place(7, 8), place(8, 7)]
const census = [resident(10, 2), resident(11, 2), resident(12, 3), resident(13, 3, true),
  resident(14, 4), resident(15, 5), resident(16, null), resident(17, 99), resident(18, 6)]
const open = (search: string) => resolveRoomLink(parseRoomLink(search), places, census)

test('place links parse a positive safe integer and open that public room even if empty or a container', () => {
  assert.deepEqual(parseRoomLink('?place=3'), { kind: 'place', id: 3 })
  assert.deepEqual(open('?place=3'), { roomId: 3, following: null, message: null })
  assert.deepEqual(open('?place=1'), { roomId: 1, following: null, message: null })
  assert.equal(resolveRoomLink(parseRoomLink('?place=3'), places, []).roomId, 3)
})

test('resident links accept a handle or an id and open following in the current public room', () => {
  assert.deepEqual(parseRoomLink('?resident=neighbor-12'), { kind: 'resident', target: 'neighbor-12' })
  assert.deepEqual(parseRoomLink('?resident=12'), { kind: 'resident', target: 12 })
  for (const target of ['neighbor-12', '12']) {
    assert.deepEqual(open(`?resident=${target}`), { roomId: 3, following: 12, message: null })
  }
})

test('resident takes priority over place, including an unavailable or empty resident target', () => {
  assert.deepEqual(open('?place=1&resident=neighbor-12'), { roomId: 3, following: 12, message: null })
  assert.deepEqual(open('?resident=12&place=1'), { roomId: 3, following: 12, message: null })
  for (const target of ['missing', '', '13', '15']) {
    const selection = open(`?place=3&resident=${target}`)
    assert.equal(selection.roomId, 2)
    assert.equal(selection.following, null)
    assert.match(selection.message!, /resident.*Showing the usual opening room\./)
  }
})

test('absent selection and fixture parameters keep the usual opening without a notice', () => {
  for (const query of ['', '?census=fixtures/census.json&map=fixtures/map.json&places=fixtures/places']) {
    assert.deepEqual(parseRoomLink(query), { kind: 'none' })
    assert.deepEqual(open(query), { roomId: 2, following: null, message: null })
  }
  const fixtures = '&census=fixtures/census.json&map=fixtures/map.json&cursor=head.json&changes=feed.json&drawings=art&places=rooms'
  assert.deepEqual(open(`?place=3${fixtures}`), open('?place=3'))
  assert.deepEqual(open(`?resident=12${fixtures}`), open('?resident=12'))
})

test('bad place values are rejected without coercion and fall back with a plain status', () => {
  for (const value of ['', '0', '-1', '1.5', '1e0', '0x1', 'Infinity', 'NaN', '9007199254740992', 'room', ' 3 ', '/3']) {
    assert.deepEqual(parseRoomLink(`?place=${encodeURIComponent(value)}`), { kind: 'invalid', target: 'place' })
    assert.deepEqual(open(`?place=${encodeURIComponent(value)}`), {
      roomId: 2, following: null, message: 'That room is unavailable. Showing the usual opening room.',
    })
  }
})

test('unknown rooms, quiet rooms and descendants, broken ancestry and cycles use the usual opening', () => {
  for (const id of [99, 4, 5, 6, 7, 8]) {
    assert.deepEqual(open(`?place=${id}`), {
      roomId: 2, following: null, message: 'That room is unavailable. Showing the usual opening room.',
    })
  }
})

test('bad or unknown resident values fall back with a plain status', () => {
  for (const value of ['', '0', '9007199254740992', 'missing', '<script>', 'neighbor-12\n', 'neighbor 12', '12.5']) {
    assert.deepEqual(open(`?resident=${encodeURIComponent(value)}`), {
      roomId: 2, following: null, message: 'That resident is unavailable. Showing the usual opening room.',
    })
  }
  assert.deepEqual(parseRoomLink('?resident='), { kind: 'invalid', target: 'resident' })
  assert.deepEqual(parseRoomLink('?resident=%0A'), { kind: 'invalid', target: 'resident' })
})

test('sleeping and hidden residents do not start a follow or disclose hidden room names', () => {
  assert.deepEqual(open('?resident=13'), {
    roomId: 2, following: null, message: 'That resident is asleep. Showing the usual opening room.',
  })
  for (const id of [14, 15, 16, 17, 18]) {
    assert.deepEqual(open(`?resident=${id}`), {
      roomId: 2, following: null, message: 'That resident is not in a public room. Showing the usual opening room.',
    })
  }
})

test('an id with no usable public handle falls back instead of following an absent figure', () => {
  for (const handle of [null, '', ' ', 'resident:12']) {
    assert.deepEqual(resolveRoomLink(parseRoomLink('?resident=12'), places, [{ ...resident(12, 3), handle }]), {
      roomId: 3, following: null, message: 'That resident is unavailable. Showing the usual opening room.',
    })
  }
})

test('no public opening gives an honest status rather than claiming a room is displayed', () => {
  assert.deepEqual(resolveRoomLink(parseRoomLink('?place=4'), [place(4, null, true)], []), {
    roomId: null, following: null, message: 'That room is unavailable. No public room is available.',
  })
})

const fixtureSearch = 'census=fixtures%2Fpresence.json&map=map.json&cursor=head.json&changes=feed.json&drawings=art&places=rooms'
const address = `https://viewer.example/live/?${fixtureSearch}&place=1&resident=old#room`
const changes: ReadonlyArray<Readonly<{ label: string; selection: RoomLinkSelection; expected: string }>> = [
  { label: 'choosing a place', selection: { kind: 'place', id: 3 }, expected: '&place=3' },
  { label: 'choosing a resident', selection: { kind: 'resident', handle: 'neighbor-12' }, expected: '&resident=neighbor-12' },
  { label: 'clearing either picker', selection: { kind: 'none' }, expected: '' },
]
for (const { label, selection, expected } of changes) {
  test(`${label} replaces the address once, preserving the /live/ path, hash, other parameters and history state`, () => {
    const state = Object.freeze({ existing: 'state' })
    const calls: unknown[][] = []
    const history = { state, replaceState: (...args: unknown[]) => { calls.push(args) } }
    replaceRoomLink(history, address, selection)
    assert.deepEqual(calls, [[state, '', `/live/?${fixtureSearch}${expected}#room`]])
  })
}

test('clearing removes both duplicate selection parameters and leaves no empty question mark', () => {
  const calls: unknown[][] = []
  replaceRoomLink({ state: null, replaceState: (...args: unknown[]) => { calls.push(args) } },
    'https://viewer.example/live/?place=1&place=3&resident=12#room', { kind: 'none' })
  assert.deepEqual(calls, [[null, '', '/live/#room']])
})

test('resident handles are encoded safely when the picker updates the address', () => {
  const calls: unknown[][] = []
  replaceRoomLink({ state: null, replaceState: (...args: unknown[]) => { calls.push(args) } },
    'https://viewer.example/', { kind: 'resident', handle: 'name&place=4' })
  assert.deepEqual(calls, [[null, '', '/?resident=name%26place%3D4']])
})
