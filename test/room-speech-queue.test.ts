import assert from 'node:assert/strict'
import test from 'node:test'

import { roomNoteMayStart } from '../src/room-speech-queue.ts'
import type { ReplayEvent } from '../src/city/types.ts'

const event = (changeId: string, actor: string, placeId: number, kind = 'note'): ReplayEvent => ({
  actor, at: '2026-01-01T00:00:00Z', change_id: changeId, event_id: Number(changeId), kind,
  detail: kind === 'note' ? { place_id: placeId } : { action: 'move', to_place_id: placeId }, line: kind === 'note' ? actor : undefined,
})
const resident = (placeId: number | null, queue: readonly ReplayEvent[] = [], bubble: null | { placeId: number | null; expiresAt: number } = null) =>
  ({ placeId, queue: queue.map(item => ({ event: item })), bubble })

test('only the earliest recorded queued note in a room may start', () => {
  const early = event('10', 'ada', 3)
  const late = event('11', 'bea', 3)
  const residents = [resident(3, [early]), resident(3, [late])]
  assert.equal(roomNoteMayStart(early, residents, 100), true)
  assert.equal(roomNoteMayStart(late, residents, 100), false)
})

test('an earlier note behind its resident move keeps a later note from jumping ahead', () => {
  const move = event('9', 'ada', 3, 'action')
  const early = event('10', 'ada', 3)
  const late = event('11', 'bea', 3)
  assert.equal(roomNoteMayStart(late, [resident(2, [move, early]), resident(3, [late])], 100), false)
})

test('active bubbles block only their room and expired bubbles do not block', () => {
  const candidate = event('20', 'ada', 3)
  assert.equal(roomNoteMayStart(candidate, [resident(3, [candidate]), resident(3, [], { placeId: 3, expiresAt: 101 })], 100), false)
  assert.equal(roomNoteMayStart(candidate, [resident(3, [candidate]), resident(4, [], { placeId: 4, expiresAt: 101 })], 100), true)
  assert.equal(roomNoteMayStart(candidate, [resident(3, [candidate]), resident(3, [], { placeId: 3, expiresAt: 100 })], 100), true)
})

test('numeric change ids sort correctly and event id breaks a tie', () => {
  const laterText = event('10', 'ada', 3)
  const earlierText = event('9', 'bea', 3)
  assert.equal(roomNoteMayStart(laterText, [resident(3, [laterText]), resident(3, [earlierText])], 0), false)
  const first = { ...event('10', 'ada', 3), event_id: 4 }
  const second = { ...event('10', 'bea', 3), event_id: 5 }
  assert.equal(roomNoteMayStart(second, [resident(3, [second]), resident(3, [first])], 0), false)
})

test('unknown rooms and malformed resident data cannot starve a note', () => {
  const unknown = { ...event('30', 'ada', 3), detail: {} }
  const candidate = event('31', 'bea', 3)
  assert.equal(roomNoteMayStart(unknown, [resident(null, [unknown])], 0), true)
  assert.equal(roomNoteMayStart(candidate, { broken: {}, bea: resident(3, [candidate]) }, 0), true)
})
