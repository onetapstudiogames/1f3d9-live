import assert from 'node:assert/strict'
import test from 'node:test'
import { awakeRoomChoices, followRoomState } from '../src/room-follow.ts'
import { nestedLayout } from '../src/ground/nested.ts'

const layout = nestedLayout([{ id: 1, parent_id: null }, { id: 2, parent_id: 1 }])
const residents = { 7: { id: 7, handle: 'Ada', placeId: 1 }, 8: { id: 8, handle: 'Bea', placeId: 2 } }

test('the resident picker excludes sleepers and restores their choices on wake', () => {
  assert.deepEqual(awakeRoomChoices(residents, layout, new Set([7])), [{ id: 8, name: 'Bea' }])
  assert.deepEqual(awakeRoomChoices(residents, layout, new Set()), [{ id: 7, name: 'Ada' }, { id: 8, name: 'Bea' }])
  assert.deepEqual(awakeRoomChoices({ ...residents, 9: { id: 9, handle: 'unknown', placeId: 99 } }, undefined, new Set()), [])
})

test('a followed sleeper releases follow, explains why, and keeps the current room', () => {
  const next = followRoomState(8, 1, residents, new Set([8]))
  assert.deepEqual(next, { following: null, roomId: 1, sleepingId: 8, message: 'Bea fell asleep. Staying in this room.' })
  assert.equal(followRoomState(next.following, next.roomId, residents, new Set([8])).message, null)
  assert.deepEqual(followRoomState(7, 1, residents, new Set([8])), { following: 7, roomId: 1, sleepingId: null, message: null })
})
