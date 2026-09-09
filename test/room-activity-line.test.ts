import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActivityContext, ActivityEntry } from '../src/activity.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import { activityEntriesWitnessedInRoom, roomActivityScrollTop, roomActivityStripHeight, RoomActivityLine } from '../src/scenes/RoomActivityLine.ts'

const context: ActivityContext = { resident: name => ({ type: 'resident', id: 1, name, hasDrawing: false }),
  place: id => ({ id, name: `room ${id}`, parentId: null, quiet: id === 9, hasDrawing: false }), roomName: id => `room ${id}` }
const entry = (key: string, roomId: number, time = Number(key) || 1): ActivityEntry => Object.freeze({ key, changeId: Number(key) || 0,
  time, kind: 'event', text: `event ${key}`, entities: Object.freeze([]), roomId })
const row = (id: number, roomId: number): ReplayEvent => ({ actor: 'author', at: new Date(id).toISOString(), change_id: String(id), event_id: id,
  kind: 'note', detail: { note_id: id, place_id: roomId }, line: `note ${id}`, line_cut: false })

class FakeNode { textContent = ''; dataset: Record<string, string> = {}; parentNode: FakeElement | null = null }
class FakeElement extends FakeNode { children: FakeNode[] = []; scrollTop = 0; clientHeight = 60; scrollHeight = 0; style = { height: '', minHeight: '' }
  ownerDocument = { createElement: () => new FakeNode() }
  appendChild(node: FakeNode): FakeNode { node.parentNode = this; this.children.push(node); this.sync(); return node }
  insertBefore(node: FakeNode, reference: FakeNode | null): FakeNode { node.parentNode?.removeChild(node); node.parentNode = this; const at = reference ? this.children.indexOf(reference) : -1; this.children.splice(at < 0 ? this.children.length : at, 0, node); this.sync(); return node }
  removeChild(node: FakeNode): FakeNode { this.children = this.children.filter(child => child !== node); node.parentNode = null; this.sync(); return node }
  replaceChildren(): void { for (const child of this.children) child.parentNode = null; this.children = []; this.sync() }
  private sync(): void { this.textContent = this.children.map(child => child.textContent).join('\n'); this.scrollHeight = this.children.length * 20 } }

test('stores only events witnessed in the displayed room and never reveals missed events later', () => { const line = { textContent: '' } as HTMLElement; const log = new RoomActivityLine(line, context)
  log.selectRoom(2); log.appendEntries([entry('1', 2), entry('2', 3)]); assert.equal(line.textContent, 'event 1')
  log.selectRoom(3); assert.equal(line.textContent, 'event 1'); log.appendEntries([entry('3', 3)]); assert.equal(line.textContent, 'event 1\nevent 3') })

test('starts empty and reset never seeds replay history', () => { const line = { textContent: 'stale' } as HTMLElement; const log = new RoomActivityLine(line, context)
  log.selectRoom(2); log.reset([row(1, 2)], 10); assert.equal(line.textContent, ''); assert.deepEqual(log.snapshot().entries, []) })

test('witnesses a future-dated event immediately once with a finite observation watermark', () => {
  const line = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(line, context)
  log.selectRoom(2)
  const future = { ...row(1, 2), at: '2099-01-01T00:00:00.000Z' }

  assert.equal(log.witness([future], 1_000).length, 1)
  assert.equal(log.witness([future], 1_000).length, 0)
  assert.equal(line.textContent, 'author in room 2: note 1')
})

test('keeps latest 200 witnessed entries globally across public room moves', () => { const log = new RoomActivityLine({ textContent: '' } as HTMLElement, context); log.selectRoom(2)
  log.appendEntries(Array.from({ length: 150 }, (_, i) => entry(String(i + 1), 2))); log.selectRoom(3)
  log.appendEntries(Array.from({ length: 100 }, (_, i) => entry(String(i + 151), 3))); assert.equal(log.snapshot().entries.length, 200); assert.equal(log.snapshot().entries[0]?.key, '51') })

test('quiet room clears history and public room cannot reveal it again', () => { const line = { textContent: '' } as HTMLElement; const log = new RoomActivityLine(line, context)
  log.selectRoom(2); log.appendEntries([entry('1', 2)]); log.selectRoom(9); assert.deepEqual(log.snapshot().entries, []); log.selectRoom(2); assert.equal(line.textContent, '') })

test('refreshing the same room clears history when it becomes quiet', () => {
  let quiet = false
  const dynamicContext: ActivityContext = {
    ...context,
    place: id => ({ id, name: `room ${id}`, parentId: null, quiet, hasDrawing: false }),
  }
  const line = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(line, dynamicContext)
  log.selectRoom(2)
  log.appendEntries([entry('1', 2)])

  quiet = true
  log.selectRoom(2)

  assert.equal(line.textContent, '')
  assert.deepEqual(log.snapshot().entries, [])
})

test('inserts older and newer witnessed events in order without exceeding 200', () => {
  const log = new RoomActivityLine({ textContent: '' } as HTMLElement, context)
  log.selectRoom(2)
  log.appendEntries([entry('new', 2, 300), entry('old', 2, 100), entry('middle', 2, 200)])
  log.appendEntries(Array.from({ length: 198 }, (_, index) => entry(`later-${index}`, 2, 400 + index)))

  const history = log.snapshot().entries
  assert.equal(history.length, 200)
  assert.equal(history[0]?.key, 'middle')
  assert.equal(history[1]?.key, 'new')
})

test('clearHistory resets followed-resident history', () => { const line = { textContent: '' } as HTMLElement; const log = new RoomActivityLine(line, context)
  log.selectRoom(2); log.appendEntries([entry('1', 2)]); log.clearHistory(); assert.equal(line.textContent, ''); assert.deepEqual(log.snapshot().entries, []) })

test('snapshot restore retains witnessed history', () => { const line = { textContent: '' } as HTMLElement; const log = new RoomActivityLine(line, context)
  log.selectRoom(2); log.appendEntries([entry('1', 2)]); const saved = log.snapshot(); log.clearHistory(); log.restore(saved); assert.equal(line.textContent, 'event 1') })

test('keeps keyed DOM nodes while appending and trimming', () => { const line = new FakeElement(); const log = new RoomActivityLine(line as unknown as HTMLElement, context)
  log.selectRoom(2); log.appendEntries([entry('1', 2), entry('2', 2)]); const second = line.children[1]
  log.appendEntries(Array.from({ length: 199 }, (_, i) => entry(String(i + 3), 2))); assert.equal(line.children.length, 200); assert.equal(line.children[0], second) })

test('move is witnessed from either endpoint and sorted by event time', () => { const move = Object.freeze({ ...entry('2', 3, 2), kind: 'move' as const,
  entities: Object.freeze([{ type: 'place' as const, id: 2, name: 'two', hasDrawing: false }, { type: 'place' as const, id: 3, name: 'three', hasDrawing: false }]) })
  assert.deepEqual(activityEntriesWitnessedInRoom([entry('3', 2, 3), move, entry('1', 4, 1)], 2).map(row => row.key), ['2', '3']) })

test('keeps scrollback and responsive strip policy', () => { assert.equal(roomActivityScrollTop({ scrollTop: 20, clientHeight: 60, scrollHeight: 200 }, 240), 20)
  assert.equal(roomActivityScrollTop({ scrollTop: 140, clientHeight: 60, scrollHeight: 200 }, 240), 180); assert.equal(roomActivityStripHeight(600), 40); assert.equal(roomActivityStripHeight(601), 60) })
