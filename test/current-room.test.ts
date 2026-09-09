import assert from 'node:assert/strict'
import test from 'node:test'
import { placesAfterOutline } from '../src/current-room.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { roomIsPublic } from '../src/room-view.ts'
import type { ReplayPlace } from '../src/city/types.ts'

const places: readonly ReplayPlace[] = [
  { id: 1, name: 'Hall', parent_id: null, quiet: false, owner: null, owner_id: null, has_drawing: false },
  { id: 2, name: 'Room', parent_id: 1, quiet: false, owner: null, owner_id: null, has_drawing: false },
]

test('a newer outline making a room quiet hides that room and descendants immediately', () => {
  const outline = { placeId: 1, quiet: true, things: [], totalItems: 0, hasMore: false }
  const next = placesAfterOutline(places, outline)
  assert.equal(roomIsPublic(nestedLayout(next), 2), false)
  assert.equal(places[0]!.quiet, false)
  assert.equal(placesAfterOutline(places, null), places)
})

test('current outline metadata updates only its known room without adding history', () => {
  const next = placesAfterOutline(places, { placeId: 2, name: 'Now', parentId: null, quiet: false,
    owner: 'Ada', ownerId: 7, things: [], totalItems: 0, hasMore: false })
  assert.equal(next[0], places[0])
  assert.deepEqual(next[1], { ...places[1], name: 'Now', parent_id: null, owner: 'Ada', owner_id: 7 })
})
