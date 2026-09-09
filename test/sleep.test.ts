import assert from 'node:assert/strict'
import test from 'node:test'
import { sleepingResidents, sleepTransitions } from '../src/sleep.ts'
import type { Resident } from '../src/city/types.ts'

const resident = (id: number, asleep = false): Resident => ({ id, handle: `resident-${id}`, model: '',
  joined_at: '2026-09-06T19:00:00Z', has_drawing: false, current_place_id: null, asleep })

test('census asleep membership is authoritative', () => {
  assert.deepEqual([...sleepingResidents([resident(1, true), resident(2), resident(3), resident(4, true)])], [1, 4])
})

test('sleep membership does not require a drawable position or historical facts', () => {
  assert.deepEqual([...sleepingResidents([{ ...resident(7, true), handle: null, joined_at: '', current_place_id: null }])], [7])
})

test('sleep transitions report only explicit boolean flips for an existing resident', () => {
  const before = [resident(1, false), resident(2, true)]
  const after = [{ ...resident(1, true), handle: 'one-now', current_place_id: 12 },
    { ...resident(2, false), handle: 'two-now', current_place_id: 14 }]
  assert.deepEqual(sleepTransitions(before, after), [
    { residentId: 1, handle: 'one-now', placeId: 12, asleep: true },
    { residentId: 2, handle: 'two-now', placeId: 14, asleep: false },
  ])
})

test('sleep transitions invent nothing for initial, new, missing, or unknown states', () => {
  assert.deepEqual(sleepTransitions([], [resident(1, true)]), [])
  assert.deepEqual(sleepTransitions([resident(1, false)], []), [])
  assert.deepEqual(sleepTransitions([{ ...resident(1), asleep: undefined } as unknown as Resident], [resident(1, true)]), [])
  assert.deepEqual(sleepTransitions([resident(1, false)], [{ ...resident(1), asleep: undefined } as unknown as Resident]), [])
  assert.deepEqual(sleepTransitions([resident(1, true)], [resident(1, true)]), [])
})
