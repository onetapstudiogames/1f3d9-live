import assert from 'node:assert/strict'
import test from 'node:test'
import { nestedLayout } from '../src/ground/nested.ts'
import { sleepActivityEntries } from '../src/sleep-activity.ts'

const place = (id: number, parent_id: number | null, quiet = false) => ({
  id, parent_id, quiet, name: `room ${id}`, has_drawing: false, owner: null, owner_id: null,
})
const layout = nestedLayout([place(1, null), place(2, 1), place(3, 1, true), place(4, 3)])

test('the room log describes explicit census sleep and wake changes', () => {
  const changes = [
    { residentId: 7, handle: 'Ada', placeId: 2, asleep: true },
    { residentId: 8, handle: 'Bea', placeId: 2, asleep: false },
  ]
  const entries = sleepActivityEntries(changes, layout, 1_000)
  assert.deepEqual(entries.map(entry => entry.text), ['Ada fell asleep.', 'Bea woke up.'])
  assert.deepEqual(entries.map(entry => entry.roomId), [2, 2])
  assert.deepEqual(entries.map(entry => entry.actorResidentId), [7, 8])
  assert.equal(entries[0]!.key, 'sleep:7:1000:true')
})

test('sleep log changes never expose quiet descendants, unknown rooms, or unnamed residents', () => {
  const change = { residentId: 7, handle: 'Ada', placeId: 2, asleep: true }
  assert.deepEqual(sleepActivityEntries([
    { ...change, placeId: 3 }, { ...change, placeId: 4 }, { ...change, placeId: 99 },
    { ...change, placeId: null }, { ...change, handle: null }, { ...change, handle: ' ' },
  ], layout, 1_000), [])
  assert.deepEqual(sleepActivityEntries([change], undefined, 1_000), [])
})
