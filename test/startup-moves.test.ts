import test from 'node:test'
import assert from 'node:assert/strict'
import type { ReplayEvent } from '../src/city/types.ts'
import { startupMoveSuppressions } from '../src/startup-moves.ts'

const row = (changeId: string, actor: string | null, action: string, status: string,
  fromPlaceId: number, toPlaceId: number, error?: unknown): ReplayEvent => Object.freeze({
  actor,
  at: '2026-09-08T12:00:00.000Z',
  change_id: changeId,
  event_id: Number(changeId),
  kind: 'action',
  detail: { action, status, from_place_id: fromPlaceId, to_place_id: toPlaceId, ...(error === undefined ? {} : { error }) },
})

const census = (handle: string, placeId: number) => Object.freeze({ handle, current_place_id: placeId })

test('suppresses one startup move already reflected by census', () => {
  const suppressed = startupMoveSuppressions([row('1', 'ada', 'move', 'applied', 1, 2)], [census('ada', 2)])

  assert.deepEqual([...suppressed], ['1'])
})

test('suppresses the move prefix through the last census-matching destination', () => {
  const events = [
    row('2', 'ada', 'move', 'applied', 2, 3),
    row('1', ' ada ', 'move', 'applied', 1, 2),
    row('3', 'ada', 'move', 'applied', 3, 4),
  ]

  assert.deepEqual([...startupMoveSuppressions(events, [census(' ada ', 3)])], ['1', '2'])
})

test('keeps notes, failed moves, and moves for unknown actors downstream', () => {
  const note: ReplayEvent = Object.freeze({ actor: 'ada', at: '2026-09-08T12:00:01.000Z', change_id: '2',
    event_id: 2, kind: 'note', detail: { place_id: 2 }, line: 'arrived' })
  const events = [
    row('1', 'ada', 'move', 'applied', 1, 2),
    note,
    row('3', 'ada', 'move', 'failed', 2, 3),
    row('4', 'ada', 'move', 'applied', 2, 3, 'blocked'),
    row('5', 'unknown', 'move', 'applied', 8, 2),
    row('6', 'ada', 'use', 'applied', 2, 2),
  ]

  assert.deepEqual([...startupMoveSuppressions(events, [census('ada', 2)])], ['1'])
})

test('uses the last matching destination when an actor returns to the census room', () => {
  const events = [
    row('1', 'ada', 'move', 'applied', 1, 2),
    row('2', 'ada', 'go_home', 'applied', 2, 3),
    row('3', 'ada', 'move', 'applied', 3, 2),
    row('4', 'ada', 'move', 'applied', 2, 5),
  ]

  assert.deepEqual([...startupMoveSuppressions(events, [census('ada', 2)])], ['1', '2', '3'])
})
