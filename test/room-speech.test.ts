import assert from 'node:assert/strict'
import test from 'node:test'
import { hiddenRoomSpeech, type RoomSpeechResident } from '../src/room-speech.ts'
import type { NestedLayout, Room } from '../src/ground/nested.ts'

const resident = (id: number, handle: string, startedAt: number, placeId = 2): RoomSpeechResident => ({
  id, handle, placeId, bubble: { text: `words ${id}`, cut: false, placeId, startedAt, charInterval: 34,
    expiresAt: startedAt + 100, noteId: id },
})
const room = (id: number, quiet = false, parentId: number | null = null): Room => ({
  id, parentId, name: `room ${id}`, quiet, depth: 0, x: 0, y: 0, width: 300, height: 300,
  door: { x: 0, y: 0 }, standing: { x: 0, y: 0, width: 200, height: 200 }, children: [],
})
const layout: NestedLayout = { rooms: { 2: room(2), 3: room(3), 4: room(4, true), 5: room(5, false, 4) },
  rootId: 2, width: 300, height: 300 }

test('chooses the newest active speech hidden by crowding in the selected public room', () => {
  const residents = { 1: resident(1, 'first', 10), 2: resident(2, 'newest', 20), 3: resident(3, 'shown', 30) }
  const displayed = { 1: { visible: false }, 2: { visible: false }, 3: { visible: true } }

  assert.equal(hiddenRoomSpeech(residents, displayed, layout, 2, new Set(), 50), 'newest: words 2')
})

test('rejects expired, future, unnamed, other-room, quiet, unknown, and null speech', () => {
  const residents = {
    1: resident(1, 'expired', 10), 2: resident(2, 'future', 200), 3: resident(3, '  ', 40),
    4: resident(4, 'elsewhere', 40, 3),
  }
  const displayed = Object.fromEntries(Object.keys(residents).map(id => [id, { visible: false }]))

  assert.equal(hiddenRoomSpeech(residents, displayed, layout, 2, new Set(), 150), null)
  assert.equal(hiddenRoomSpeech({ 1: resident(1, 'hidden', 100) }, { 1: { visible: false } }, layout, 2, new Set([2]), 150), null)
  assert.equal(hiddenRoomSpeech({ 1: resident(1, 'quiet', 100, 4) }, {}, layout, 4, new Set(), 150), null)
  assert.equal(hiddenRoomSpeech({ 1: resident(1, 'quiet child', 100, 5) }, {}, layout, 5, new Set(), 150), null)
  assert.equal(hiddenRoomSpeech({ 1: resident(1, 'unknown', 100, 99) }, {}, layout, 99, new Set(), 150), null)
  assert.equal(hiddenRoomSpeech(residents, displayed, layout, null, new Set(), 150), null)
  assert.equal(hiddenRoomSpeech(residents, displayed, undefined, 2, new Set(), 150), null)
  const moved = { ...resident(1, 'moved', 100), bubble: { ...resident(1, 'moved', 100).bubble!, placeId: 3 } }
  assert.equal(hiddenRoomSpeech({ 1: moved }, {}, layout, 2, new Set(), 150), null)
})

test('uses note id then resident id as stable ties and preserves exact recorded text', () => {
  const olderId = { ...resident(1, 'alpha', 20), bubble: { ...resident(1, 'alpha', 20).bubble!, text: ' exact  words ', noteId: 5 } }
  const newerNote = { ...resident(2, 'beta', 20), bubble: { ...resident(2, 'beta', 20).bubble!, text: 'chosen', noteId: 6 } }
  const stableResident = { ...resident(3, 'gamma', 20), bubble: { ...resident(3, 'gamma', 20).bubble!, text: 'stable', noteId: 6 } }

  assert.equal(hiddenRoomSpeech({ 1: olderId, 2: newerNote, 3: stableResident }, {}, layout, 2, new Set(), 50),
    'gamma: stable')
  assert.equal(hiddenRoomSpeech({ 1: olderId }, {}, layout, 2, new Set(), 50), 'alpha:  exact  words ')
})
