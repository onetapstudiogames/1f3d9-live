import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActivityContext } from '../src/activity.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import { readWitnessedRoom } from '../src/witness-current-room.ts'

const context: ActivityContext = {
  resident: name => ({ type: 'resident', id: 1, name, hasDrawing: false }),
  place: id => ({ id, name: `room ${id}`, parentId: null, quiet: false, hasDrawing: false }),
  roomName: id => `room ${id}`,
}
const rows: readonly ReplayEvent[] = [2, 3].map(id => ({ change_id: String(id), event_id: id,
  at: '2026-09-08T12:00:00Z', actor: 'writer', kind: 'note', detail: { note_id: id, place_id: id } }))

test('witness filtering uses the current room when rows land, not the room before the read', async () => {
  let room = 2
  const currentRoom = () => room
  room = 3
  const seen = await readWitnessedRoom(rows, context, currentRoom, async events => events)
  assert.deepEqual(seen.map(event => event.change_id), ['3'])
})

test('switching room during note reads reselects the new room before the log write', async () => {
  let room = 2
  const reads: string[][] = []
  const seen = await readWitnessedRoom(rows, context, () => room, async events => {
    reads.push(events.map(event => event.change_id))
    room = 3
    return events
  })
  assert.deepEqual(reads, [['2'], ['3']])
  assert.deepEqual(seen.map(event => event.change_id), ['3'])
})
