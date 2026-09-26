import assert from 'node:assert/strict'
import test from 'node:test'
import type { RoomLine, RoomLinesPage } from '../src/city/changes.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import { anchorsAfter, listeningIds, newRoomLines, talkCheckDelay, talkCheckMs, talkNeedsRead,
  withoutMovesBehindLines, withoutTalkLines, TALK_IDLE_CHECK_MS, TALK_IDLE_MS } from '../src/talk-tick.ts'

const line = (id: number): RoomLine => ({ id, placeId: 731, author: 'buzz', body: `line ${id}`,
  createdAt: '2026-09-07T13:54:05.000Z' })
const event = (kind: string, actor: string | null, at: string, detail: ReplayEvent['detail'] = {}): ReplayEvent => ({
  actor, at, change_id: '100299', event_id: 9001, kind, detail,
})

test('uses the served check interval with a two second floor and ten minute ceiling', () => {
  for (const [value, expected] of [[2_000, 2_000], [4_000, 4_000], [500, 2_000], [1_000_000_000, 600_000],
    ['2000', 2_000], [null, 2_000], [2.5, 2_000], [Number.NaN, 2_000], [-1, 2_000]] as const) {
    assert.equal(talkCheckMs(value), expected)
  }
})

test('backs off failed checks and slows an idle page after thirty minutes', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(failure => talkCheckDelay(failure, 2_000)),
    [2_000, 4_000, 8_000, 16_000, 30_000, 30_000])
  assert.equal(talkCheckDelay(0, 60_000), 60_000)
  assert.equal(talkCheckDelay(1, 60_000), 60_000)
  assert.equal(TALK_IDLE_MS, 30 * 60_000)
  assert.equal(TALK_IDLE_CHECK_MS, 30_000)
  assert.equal(talkCheckDelay(0, 2_000, TALK_IDLE_MS), 30_000)
  assert.equal(talkCheckDelay(0, 60_000, TALK_IDLE_MS), 60_000)
  assert.equal(talkCheckDelay(1, 2_000, TALK_IDLE_MS), 4_000)
})

test('compares decimal line markers exactly, including markers beyond number precision', () => {
  assert.equal(talkNeedsRead(null, '8'), true)
  assert.equal(talkNeedsRead('8', '9'), true)
  assert.equal(talkNeedsRead('9', '9'), false)
  assert.equal(talkNeedsRead('10', '9'), false)
  assert.equal(talkNeedsRead('9007199254740992999', '9007199254740993000'), true)
  assert.equal(talkNeedsRead('9007199254740993000', '9007199254740992999'), false)
})

test('returns unseen room lines by id, including late ids, and remembers removed ids', () => {
  const seen = new Set([4])
  const page: RoomLinesPage = { lines: [line(9), line(2), line(4)], removedIds: [6], dropped: 0 }
  const next = newRoomLines(page, seen)

  assert.deepEqual(next.fresh.map(row => row.id), [2, 9])
  assert.deepEqual([...next.seen].sort((a, b) => a - b), [2, 4, 6, 9])
  assert.deepEqual([...seen], [4])
  assert.deepEqual(page.lines.map(row => row.id), [9, 2, 4])
})

test('marks the head stale after ten seconds and returns only the selected room listeners', () => {
  const head = { lineMarker: '100299', checkMs: 2_000, listening: [
    { placeId: 731, residentId: 302, handle: 'buzz', listeningUntil: '2026-09-07T13:54:35.000Z' },
    { placeId: 732, residentId: 303, handle: 'ada', listeningUntil: '2026-09-07T13:54:35.000Z' },
  ] }
  assert.deepEqual([...listeningIds(null, 731, 1_000, 1_000)], [])
  assert.deepEqual([...listeningIds(head, null, 1_000, 1_000)], [])
  assert.deepEqual([...listeningIds(head, 731, 1_000, 11_001)], [])
  assert.deepEqual([...listeningIds(head, 731, 1_000, 11_000)], [302])
})

test('removes only line rows from the slower refresh without changing its input', () => {
  const rows = [event('line_said', 'buzz', '2026-09-07T13:54:05.000Z'), event('note', 'ada', '2026-09-07T13:54:06.000Z')]
  const before = [...rows]
  const next = withoutTalkLines(rows)

  assert.deepEqual(next.map(row => row.kind), ['note'])
  assert.deepEqual(rows, before)
})

test('removes moves behind a line anchor by actor, room, and time', () => {
  const anchor = { placeId: 731, at: '2026-09-07T13:54:05.000Z', refresh: 4 }
  const anchors = new Map([['buzz', anchor]])
  const rows = [
    event('action', 'buzz', '2026-09-07T13:54:04.000Z', { status: 'applied', action: 'move', to_place_id: 731 }),
    event('action', 'buzz', '2026-09-07T13:54:05.000Z', { status: 'applied', action: 'go_home', to_place_id: 731 }),
    event('action', 'buzz', '2026-09-07T13:54:06.000Z', { status: 'applied', action: 'move', to_place_id: 731 }),
    event('action', 'buzz', '2026-09-07T13:54:04.000Z', { status: 'applied', action: 'move', to_place_id: 732 }),
    event('action', 'ada', '2026-09-07T13:54:04.000Z', { status: 'applied', action: 'move', to_place_id: 731 }),
    event('action', 'buzz', '2026-09-07T13:54:04.000Z', { status: 'refused', action: 'move', to_place_id: 731 }),
  ]
  const before = [...rows]
  const next = withoutMovesBehindLines(rows, anchors)

  assert.deepEqual(next, rows.slice(2))
  assert.deepEqual(rows, before)
  assert.deepEqual([...anchors], [['buzz', anchor]])
})

test('keeps anchors set during or after a refresh and removes older anchors', () => {
  const anchors = new Map<string, { placeId: number; at: string; refresh: number }>([
    ['early', { placeId: 1, at: '2026-09-07T13:54:05.000Z', refresh: 3 }],
    ['current', { placeId: 2, at: '2026-09-07T13:54:05.000Z', refresh: 4 }],
    ['later', { placeId: 3, at: '2026-09-07T13:54:05.000Z', refresh: 5 }],
  ])
  const next = anchorsAfter(anchors, 4)

  assert.deepEqual([...next.keys()], ['current', 'later'])
  assert.deepEqual([...anchors.keys()], ['early', 'current', 'later'])
})
