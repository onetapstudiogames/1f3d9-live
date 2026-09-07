import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayEvent } from '../src/city/types.ts'
import { activityEntry, activityReduce, activityVisible, createActivityContext, emptyActivity, type ActivityContext, type ActivityPlace } from '../src/activity.ts'

const places = new Map<number, ActivityPlace>([
  [1, { id: 1, name: 'the world', parentId: null, quiet: false, hasDrawing: true }],
  [2, { id: 2, name: 'the old square', parentId: 1, quiet: false, hasDrawing: false }],
  [3, { id: 3, name: 'the quiet house', parentId: 1, quiet: true, hasDrawing: false }],
  [4, { id: 4, name: 'the hidden room', parentId: 3, quiet: false, hasDrawing: false }],
] as const)
const context: ActivityContext = {
  resident: actor => actor === 'vigil' ? { type: 'resident', id: 7, name: 'vigil', hasDrawing: true } : null,
  place: id => places.get(id) ?? null,
  roomName: (id, time) => id === 2 && time >= 2_000 ? 'the new square' : places.get(id)?.name ?? null,
}
const row = (changeId: number, kind: string, detail: ReplayEvent['detail'], at = changeId * 1_000): ReplayEvent => ({
  actor: 'vigil', at: new Date(at).toISOString(), change_id: String(changeId), event_id: changeId,
  kind, detail,
})

test('formats recorded chats, moves, and made things with only linked entities', () => {
  const note = { ...row(1, 'note', { note_id: 9, place_id: 2 }), line: 'hello <city>', line_cut: false }
  assert.deepEqual(activityEntry(note, context), {
    key: '1', changeId: 1, time: 1_000, kind: 'chat', text: 'vigil in the old square: hello <city>',
    entities: [
      { type: 'resident', id: 7, name: 'vigil', hasDrawing: true },
      { type: 'place', id: 2, name: 'the old square', hasDrawing: false },
    ],
  })
  assert.equal(activityEntry(row(2, 'action', { action: 'move', status: 'applied', from_place_id: 1, to_place_id: 2 }), context)?.text,
    'vigil moved from the world to the new square.')
  const made = activityEntry(row(3, 'thing_created', { thing_id: 22, place_id: 2, name: 'small bell' }), context)!
  assert.equal(made.text, 'vigil made small bell in the new square.')
  assert.deepEqual(made.entities.at(-1), { type: 'thing', id: 22, name: 'small bell', hasDrawing: null })
})

test('builds linked resident and place facts without replacing the recorded room-name resolver', () => {
  const built = createActivityContext([
    { id: 7, handle: ' vigil ', model: '', joined_at: '', has_drawing: true, current_place_id: 2, asleep: false },
  ], [{ id: 2, name: 'current name', parent_id: null, owner: null, owner_id: null, quiet: false, has_drawing: false }],
  (_place, time) => time < 2_000 ? 'historic name' : 'current name')
  assert.equal(built.resident('vigil')?.id, 7)
  assert.equal(built.roomName(2, 1_000), 'historic name')
})

test('rejects incomplete facts, failed moves, unknown rooms, and quiet ancestry', () => {
  assert.equal(activityEntry(row(1, 'action', { action: 'move', status: 'noop', from_place_id: 1, to_place_id: 2 }), context), null)
  assert.equal(activityEntry(row(1, 'note', { note_id: 9, place_id: 99 }), context), null)
  assert.equal(activityEntry(row(1, 'note', { note_id: 9, place_id: 4 }), context), null)
  assert.equal(activityEntry({ ...row(1, 'note', { note_id: 9, place_id: 2 }), actor: null }, context), null)
  assert.equal(activityEntry(row(1, 'thing_created', { thing_id: 2, place_id: 2, name: '   ' }), context), null)
})

test('reduces only due rows in change order, deduplicates, caps history, and resets cleanly', () => {
  const notes = Array.from({ length: 105 }, (_, index) => ({
    ...row(index + 1, 'note', { note_id: index + 1, place_id: 2 }), line: `line ${index + 1}`,
  }))
  const first = activityReduce(emptyActivity(), [...notes].reverse(), 103_500, context)
  assert.equal(first.entries.length, 100)
  assert.deepEqual(first.entries.map(entry => entry.changeId).slice(0, 2), [4, 5])
  assert.equal(first.highWater, 103)
  const retry = activityReduce(first, [notes[102]!, notes[103]!, notes[103]!], 104_500, context)
  assert.deepEqual(retry.entries.map(entry => entry.changeId).slice(-2), [103, 104])
  assert.equal(retry.entries.length, 100)
  const reset = activityReduce(emptyActivity(), [notes[0]!], 2_000, context)
  assert.deepEqual(reset.entries.map(entry => entry.changeId), [1])
})

test('the Chats filter keeps the bounded conversation rows without changing history', () => {
  const state = activityReduce(emptyActivity(), [
    row(1, 'action', { action: 'move', status: 'applied', from_place_id: 1, to_place_id: 2 }),
    { ...row(2, 'note', { note_id: 2, place_id: 2 }), line: 'hi' },
  ], 3_000, context)
  assert.deepEqual(activityVisible(state.entries, 'chats').map(entry => entry.kind), ['chat'])
  assert.equal(activityVisible(state.entries, 'all').length, 2)
})
