import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayEvent } from '../src/city/types.ts'
import type { Simulation } from '../src/replay/simulation.ts'
import { removedTalkIds, withoutLineBubbles } from '../src/talk-removal.ts'

const moderation = (target_type: string, target_id: unknown, action = 'remove'): ReplayEvent => ({
  actor: 'the city', at: new Date(0).toISOString(), change_id: '1', event_id: 1, kind: 'moderation',
  detail: { action, target_type, target_id },
})

test('collects line and ping removals and ignores restores, other targets, and bad IDs', () => {
  const events = [moderation('line', 12), moderation('ping', 23), moderation('line', 12, 'restore'),
    moderation('note', 34), moderation('line', 0), moderation('ping', 1.5), moderation('ping', '8')]
  const ids = removedTalkIds(events)
  assert.deepEqual(ids.lineIds, new Set([12]))
  assert.deepEqual(ids.pingIds, new Set([23]))
})

test('clears only matching line bubbles, preserves notes, and leaves its input unchanged', () => {
  const lineBubble = { text: 'line', cut: false, placeId: 2, size: 'line' as const,
    lineId: 12, startedAt: 0, charInterval: 0, expiresAt: 100 }
  const noteBubble = { text: 'note', cut: false, placeId: 2, size: 'note' as const,
    noteId: 31, startedAt: 0, charInterval: 0, expiresAt: 100 }
  const state = { residents: {
    1: { id: 1, bubble: lineBubble },
    2: { id: 2, bubble: noteBubble },
    3: { id: 3, bubble: { ...lineBubble, lineId: 99 } },
  } } as unknown as Simulation
  const result = withoutLineBubbles(state, new Set([12]))
  assert.notEqual(result, state)
  assert.equal(result.residents[1]?.bubble, null)
  assert.deepEqual(result.residents[2]?.bubble, noteBubble)
  assert.equal(result.residents[3]?.bubble?.lineId, 99)
  assert.equal(state.residents[1]?.bubble?.lineId, 12)
  assert.deepEqual(state.residents[2]?.bubble, noteBubble)
})

test('keeps the same simulation when no line bubble matches', () => {
  const state = { residents: { 1: { id: 1, bubble: { lineId: 99 } } } } as unknown as Simulation
  assert.equal(withoutLineBubbles(state, new Set([12])), state)
})
