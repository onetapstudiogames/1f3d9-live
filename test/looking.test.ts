import assert from 'node:assert/strict'
import test from 'node:test'
import { stepLookingPresence } from '../src/looking.ts'
import type { Resident } from '../src/city/types.ts'

const resident = (looking?: Resident['looking']): Resident => ({
  id: 7, handle: 'lantern', model: '', joined_at: '2026-01-01T00:00:00Z',
  has_drawing: true, current_place_id: 3, asleep: true, looking,
})
const rooms = new Map([[7, 3]])

test('opening seeds an existing look without announcing old activity', () => {
  const result = stepLookingPresence(undefined, {
    residents: [resident({ place_id: 3, started_at: '2026-09-07T12:00:00Z', expires_at: '2026-09-07T12:01:00Z' })],
    wallNow: Date.parse('2026-09-07T12:00:20Z'), playingLive: true, recordedPlaceByResident: rooms,
  })
  assert.equal(result.moments.length, 0)
  assert.deepEqual(result.active.map(item => item.residentId), [7])
})

test('a newly witnessed burst emits once and expires by wall time between polls', () => {
  const opened = stepLookingPresence(undefined, {
    residents: [resident()], wallNow: Date.parse('2026-09-07T12:00:00Z'), playingLive: true,
    recordedPlaceByResident: rooms,
  })
  const seen = stepLookingPresence(opened.state, {
    residents: [resident({ place_id: 3, started_at: '2026-09-07T12:00:04Z', expires_at: '2026-09-07T12:01:04Z' })],
    wallNow: Date.parse('2026-09-07T12:00:05Z'), playingLive: true, recordedPlaceByResident: rooms,
  })
  assert.deepEqual(seen.moments, [{
    key: 'looking:7:3:2026-09-07T12:00:04.000Z', residentId: 7, roomId: 3,
    name: 'lantern', expiresAt: Date.parse('2026-09-07T12:01:04Z'),
  }])
  assert.equal(stepLookingPresence(seen.state, {
    residents: [], wallNow: Date.parse('2026-09-07T12:01:05Z'), playingLive: true,
    recordedPlaceByResident: rooms,
  }).active.length, 0)
})

test('pause, replay, room mismatch, and quiet rooms seed without delayed announcements', () => {
  const look = { place_id: 3, started_at: '2026-09-07T12:00:04Z', expires_at: '2026-09-07T12:01:04Z' }
  for (const input of [
    { playingLive: false, recordedPlaceByResident: rooms },
    { playingLive: true, recordedPlaceByResident: new Map([[7, 4]]) },
    { playingLive: true, recordedPlaceByResident: rooms, quietPlaceIds: new Set([3]) },
  ]) {
    const opened = stepLookingPresence(undefined, { residents: [resident()], wallNow: Date.parse('2026-09-07T12:00:00Z'), ...input })
    const seeded = stepLookingPresence(opened.state, { residents: [resident(look)], wallNow: Date.parse('2026-09-07T12:00:05Z'), ...input })
    assert.equal(seeded.moments.length, 0)
    if (!input.playingLive) assert.equal(seeded.active.length, 0)
    const resumed = stepLookingPresence(seeded.state, {
      residents: [resident(look)], wallNow: Date.parse('2026-09-07T12:00:06Z'), playingLive: true,
      recordedPlaceByResident: rooms,
    })
    assert.equal(resumed.moments.length, 0)
  }
})

test('malformed, expired, overlong, and far-future looks are ignored', () => {
  const values = [
    { place_id: 4, started_at: '2026-09-07T12:00:00Z', expires_at: '2026-09-07T12:01:00Z' },
    { place_id: 3, started_at: 'bad', expires_at: '2026-09-07T12:01:00Z' },
    { place_id: 3, started_at: '2026-09-07T11:59:00Z', expires_at: '2026-09-07T12:00:00Z' },
    { place_id: 3, started_at: '2026-09-07T12:00:00Z', expires_at: '2026-09-07T12:02:00Z' },
    { place_id: 3, started_at: '2026-09-07T12:00:06Z', expires_at: '2026-09-07T12:01:06Z' },
  ] as Resident['looking'][]
  for (const looking of values) {
    const result = stepLookingPresence(undefined, { residents: [resident(looking)], wallNow: Date.parse('2026-09-07T12:00:00Z'), playingLive: true, recordedPlaceByResident: rooms })
    assert.equal(result.active.length, 0)
  }
})
