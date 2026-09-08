import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActivityContext, ActivityEntry } from '../src/activity.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import { activityEntryMatchesRoom, RoomActivityLine } from '../src/scenes/RoomActivityLine.ts'

const context: ActivityContext = {
  resident: name => ({ type: 'resident', id: 1, name, hasDrawing: false }),
  place: id => ({ id, name: `room ${id}`, parentId: null, quiet: false, hasDrawing: false }),
  roomName: id => `room ${id}`,
}

const entry = (key: string, roomId?: number | null, anchorRoomId?: number | null): ActivityEntry => Object.freeze({
  key, changeId: Number(key) || 0, time: 1_000, kind: 'event', text: `event ${key}`,
  entities: Object.freeze([]), roomId, anchorRoomId,
})

test('matches direct and anchored room activity, plus either end of a move', () => {
  assert.equal(activityEntryMatchesRoom(entry('1', 2), 2), true)
  assert.equal(activityEntryMatchesRoom(entry('2', null, 2), 2), true)
  const move: ActivityEntry = Object.freeze({ ...entry('3', 3, 3), kind: 'move',
    entities: Object.freeze([
      { type: 'resident' as const, id: 1, name: 'walker', hasDrawing: false },
      { type: 'place' as const, id: 2, name: 'room 2', hasDrawing: false },
      { type: 'place' as const, id: 3, name: 'room 3', hasDrawing: false },
    ]) })
  assert.equal(activityEntryMatchesRoom(move, 2), true)
  assert.equal(activityEntryMatchesRoom(move, 3), true)
  assert.equal(activityEntryMatchesRoom(move, 4), false)
  assert.equal(activityEntryMatchesRoom(entry('4'), 2), false)
})

test('shows only newly witnessed activity in the selected room and clears across lifecycle changes', () => {
  const line = { textContent: 'old' } as HTMLElement
  const log = new RoomActivityLine(line, context)
  log.reset([])
  log.selectRoom(2)
  assert.equal(line.textContent, '')

  const roomTwo = entry('1', 2)
  const roomThree = entry('2', 3)
  assert.deepEqual(log.appendEntries([roomThree, roomTwo]).map(row => row.key), ['2', '1'])
  assert.equal(line.textContent, 'event 1')

  const snapshot = log.snapshot()
  log.selectRoom(3)
  assert.equal(line.textContent, '')
  log.restore(snapshot)
  assert.equal(line.textContent, '')
  assert.equal(log.appendEntries([roomThree]).length, 0)

  log.selectRoom(2)
  assert.equal(line.textContent, '')
  log.reset([])
  assert.equal(line.textContent, '')
  log.destroy()
  assert.equal(line.textContent, '')
})

test('reduces replay events with shared wording and returns all additions for scene effects', () => {
  const line = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(line, context)
  log.selectRoom(2)
  const rows: ReplayEvent[] = [
    { actor: 'author', at: new Date(1_000).toISOString(), change_id: '1', event_id: 1,
      kind: 'note', detail: { note_id: 1, place_id: 2 }, line: 'hello', line_cut: false },
    { actor: 'author', at: new Date(1_001).toISOString(), change_id: '2', event_id: 2,
      kind: 'note', detail: { note_id: 2, place_id: 3 }, line: 'elsewhere', line_cut: false },
  ]
  assert.deepEqual(log.append(rows, 2_000).map(row => row.key), ['1', '2'])
  assert.equal(line.textContent, 'author in room 2: hello')
})
