import assert from 'node:assert/strict'
import test from 'node:test'
import { directorActivity, directorStep, rankDirectorRooms } from '../src/director.ts'
import type { ReplayEvent } from '../src/city/types.ts'

const at = '2026-09-07T12:00:00.000Z'
const row = (change_id: string, kind: string, detail: Record<string, unknown>, actor = 'lamp'): ReplayEvent =>
  ({ change_id, event_id: Number(change_id), kind, detail, actor, at })

test('activity accepts only complete recorded moves, notes, and creations once', () => {
  const rows = [row('1', 'action', { action: 'move', status: 'applied', from_place_id: 1, to_place_id: 2, action_id: 9 }),
    row('1', 'action', { action: 'move', status: 'applied', from_place_id: 1, to_place_id: 2, action_id: 9 }),
    row('2', 'note', { place_id: 3, note_id: 7 }),
    row('3', 'thing_created', { place_id: 3, thing_id: 8, name: 'bell' }),
    row('4', 'action', { action: 'make', status: 'applied', place_id: 3 }),
    row('5', 'thing_created', { place_id: 4, thing_id: 9, name: '', error: 'no' }),
    row('6', 'action', { action: 'go_home', status: 'applied', from_place_id: 4, to_place_id: 5 }),
    row('7', 'action', { action: 'move', status: 'applied', from_place_id: 5, to_place_id: 5 })]
  assert.deepEqual(directorActivity(rows, Date.parse(at)), [{ changeId: '1', placeId: 2 }, { changeId: '2', placeId: 3 },
    { changeId: '3', placeId: 3 }, { changeId: '6', placeId: 5 }])
})

test('activity uses the recorded clock window and rejects future or invalid rows', () => {
  const rows = [row('1', 'note', { place_id: 1, note_id: 1 }),
    { ...row('2', 'note', { place_id: 2, note_id: 2 }), at: '2026-09-07T11:54:59.999Z' },
    { ...row('3', 'note', { place_id: 3, note_id: 3 }), at: '2026-09-07T12:00:00.001Z' },
    { ...row('4', 'note', { place_id: 4, note_id: 4 }), at: 'bad' }]
  assert.deepEqual(directorActivity(rows, Date.parse(at)).map(item => item.placeId), [1])
})

test('rooms rank by activity then id and omit hidden or unknown rooms', () => {
  const activity = [{ changeId: '1', placeId: 4 }, { changeId: '2', placeId: 3 }, { changeId: '3', placeId: 4 }, { changeId: '4', placeId: 3 }, { changeId: '5', placeId: 8 }]
  assert.deepEqual(rankDirectorRooms(activity, new Set([3, 4, 5]), new Set([5])), [3, 4])
})

test('director lingers, rotates, and waits without moving when no room is eligible', () => {
  const first = directorStep({ roomId: null, nextAt: 0 }, [3, 4], 1_000)
  assert.deepEqual(first, { roomId: 3, nextAt: 9_000, changed: true, waiting: false })
  assert.equal(directorStep(first, [3, 4], 8_999).changed, false)
  assert.equal(directorStep(first, [3, 4], 9_000).roomId, 4)
  assert.deepEqual(directorStep(first, [], 12_000), { roomId: null, nextAt: 12_000, changed: false, waiting: true })
})
