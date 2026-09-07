import assert from 'node:assert/strict'
import test from 'node:test'
import { initialResidents, residentIndex } from '../src/city/residents.ts'
import type { ReplayFile, Resident } from '../src/city/types.ts'

const census: Resident[] = [
  { id: 2, handle: 'actor', model: '', joined_at: '2025-12-01T00:00:00Z', has_drawing: true, current_place_id: 8, asleep: false },
  { id: 1, handle: 'starter', model: '', joined_at: '2025-12-01T00:00:00Z', has_drawing: false, current_place_id: 9, asleep: false },
  { id: 3, handle: 'quiet-one', model: '', joined_at: '2025-12-01T00:00:00Z', has_drawing: false, current_place_id: 7, asleep: true },
  { id: 4, handle: 'newcomer', model: '', joined_at: '2026-02-01T00:00:00Z', has_drawing: false, current_place_id: 7, asleep: false },
  { id: 5, handle: null, model: '', joined_at: '2025-12-01T00:00:00Z', has_drawing: false, current_place_id: 7, asleep: false },
  { id: 6, handle: 'nowhere', model: '', joined_at: '2025-12-01T00:00:00Z', has_drawing: false, current_place_id: null, asleep: false },
  { id: 9, handle: 'explicitly-unplaced', model: '', joined_at: '2025-12-01T00:00:00Z', has_drawing: false, current_place_id: 7, asleep: false },
  { id: 10, handle: 'bad-date', model: '', joined_at: 'not-a-date', has_drawing: false, current_place_id: 7, asleep: false },
]

const replay = {
  window_start: '2026-01-01T00:00:00Z',
  start: { 'resident:1': { origin_event_id: 1, place_id: 4 }, 'thing:9': { origin_event_id: 1, place_id: 2 }, 'resident:999': { place_id: 2 }, 'resident:8': { place_id: null }, 'resident:9': null },
  timeline: [
    { actor: 'actor', at: '2026-01-01T00:01:00Z', change_id: '1', event_id: 1, kind: 'action', detail: {} },
    { actor: null, at: '2026-01-01T00:02:00Z', change_id: '2', event_id: 2, kind: 'register', detail: {} },
  ],
} as unknown as ReplayFile

test('residentIndex keys residents with handles and skips null handles', () => {
  const index = residentIndex(census)
  assert.equal(index.get('starter')?.id, 1)
  assert.equal(index.has(''), false)
  assert.equal(index.size, 7)
})

test('initialResidents uses replay starts, then only historically safe census positions', () => {
  assert.deepEqual(initialResidents(replay, census), [
    { id: 1, handle: 'starter', placeId: 4 },
    { id: 999, handle: 'resident 999', placeId: 2 },
    { id: 3, handle: 'quiet-one', placeId: 7 },
  ])
})

test('initialResidents never resurrects null starts or residents with invalid join dates', () => {
  const residents = initialResidents(replay, census)
  assert.equal(residents.some(item => item.id === 9), false)
  assert.equal(residents.some(item => item.id === 10), false)
})
