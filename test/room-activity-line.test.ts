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

test('renders the newest stored activity when selecting, restoring, and resetting rooms', () => {
  const line = { textContent: 'old' } as HTMLElement
  const log = new RoomActivityLine(line, context)
  log.selectRoom(2)
  assert.equal(line.textContent, '')

  const roomTwo = entry('1', 2)
  const roomThree = entry('2', 3)
  assert.deepEqual(log.appendEntries([roomThree, roomTwo]).map(row => row.key), ['2', '1'])
  assert.equal(line.textContent, 'event 1')

  const snapshot = log.snapshot()
  log.selectRoom(3)
  assert.equal(line.textContent, 'event 2')
  log.restore(snapshot)
  assert.equal(line.textContent, 'event 2')
  assert.equal(log.appendEntries([roomThree]).length, 0)

  log.selectRoom(2)
  assert.equal(line.textContent, 'event 1')
  log.reset([])
  assert.equal(line.textContent, '')
  log.destroy()
  assert.equal(line.textContent, '')
})

test('keeps each room latest line from a loaded window larger than the live history limit', () => {
  const line = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(line, context)
  log.selectRoom(2)
  const rows: ReplayEvent[] = [
    { actor: 'author', at: new Date(1_000).toISOString(), change_id: '1', event_id: 1,
      kind: 'note', detail: { note_id: 1, place_id: 2 }, line: 'room two latest', line_cut: false },
    ...Array.from({ length: 101 }, (_, index): ReplayEvent => ({
      actor: 'author', at: new Date(1_001 + index).toISOString(), change_id: String(index + 2), event_id: index + 2,
      kind: 'note', detail: { note_id: index + 2, place_id: 3 }, line: `room three ${index}`, line_cut: false,
    })),
  ]

  log.reset(rows, 2_000)
  assert.equal(line.textContent, 'author in room 2: room two latest')
  log.selectRoom(3)
  assert.equal(line.textContent, 'author in room 3: room three 100')
  log.selectRoom(999)
  assert.equal(line.textContent, '')
})

test('retains a room latest line through live churn and snapshot restore', () => {
  const line = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(line, context)
  const row = (changeId: number, roomId: number): ReplayEvent => ({
    actor: 'author', at: new Date(changeId).toISOString(), change_id: String(changeId), event_id: changeId,
    kind: 'note', detail: { note_id: changeId, place_id: roomId }, line: `note ${changeId}`, line_cut: false,
  })
  log.reset([row(1, 2), ...Array.from({ length: 101 }, (_, index) => row(index + 2, 3))], 200)
  for (let changeId = 103; changeId <= 252; changeId += 1) log.append([row(changeId, 3)], changeId)

  log.selectRoom(2)
  assert.equal(line.textContent, 'author in room 2: note 1')
  const snapshot = log.snapshot()
  assert.ok(snapshot.entries.length <= 103)

  const restored = new RoomActivityLine(line, context)
  restored.restore(snapshot)
  restored.selectRoom(2)
  assert.equal(line.textContent, 'author in room 2: note 1')
})

test('never presents activity for quiet, quiet-descendant, unknown, or null selections', () => {
  const places = new Map([
    [2, { id: 2, name: 'public', parentId: null, quiet: false, hasDrawing: false }],
    [4, { id: 4, name: 'quiet', parentId: null, quiet: true, hasDrawing: false }],
    [5, { id: 5, name: 'quiet child', parentId: 4, quiet: false, hasDrawing: false }],
  ])
  const privateContext: ActivityContext = { ...context, place: id => places.get(id) ?? null }
  const line = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(line, privateContext)
  log.appendEntries([entry('1', 2), entry('2', 4), entry('3', 5), entry('4', 99)])

  log.selectRoom(2)
  assert.equal(line.textContent, 'event 1')
  for (const roomId of [4, 5, 99, null]) {
    log.selectRoom(roomId)
    assert.equal(line.textContent, '')
  }
})

test('uses wall time before change id for live presence, restore, and out-of-order appends', () => {
  const line = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(line, context)
  log.selectRoom(2)
  const record = Object.freeze({ ...entry('50', 2), time: 1_000, text: 'record' })
  const looking = Object.freeze({ ...entry('presence', 2), changeId: 0, time: 2_000,
    cue: 'looking' as const, text: 'looking' })
  const older = Object.freeze({ ...entry('49', 2), time: 900, text: 'older' })

  assert.deepEqual(log.appendEntries([record, looking]).map(row => row.key), ['50', 'presence'])
  assert.equal(line.textContent, 'looking')
  assert.deepEqual(log.appendEntries([older]).map(row => row.key), ['49'])
  assert.equal(line.textContent, 'looking')

  const restored = new RoomActivityLine(line, context)
  restored.restore(log.snapshot())
  restored.selectRoom(2)
  assert.equal(line.textContent, 'looking')
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
