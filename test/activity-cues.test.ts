import assert from 'node:assert/strict'
import test from 'node:test'
import { cueFrame, emptyCueState, stepActivityCues, type CueEntry } from '../src/activity-cues.ts'

const entry = (overrides: Partial<CueEntry> = {}): CueEntry => ({
  key: 'event:10', cue: 'change', startedAt: 1_000, residentId: 7, thingId: null, roomId: 3, ...overrides,
})

test('a neutral cue lasts three seconds and deduplicates its activity key', () => {
  const first = stepActivityCues(emptyCueState(), [entry()], 1_000)
  assert.equal(first.active.length, 1)
  assert.equal(stepActivityCues(first, [entry()], 2_000).active.length, 1)
  assert.equal(stepActivityCues(first, [], 4_000).active.length, 0)
})

test('events already represented by richer scene physics do not get a neutral mark', () => {
  const state = stepActivityCues(emptyCueState(), [entry()], 1_000, new Set(['event:10']))
  assert.deepEqual(state.active, [])
  assert.deepEqual(state.seenKeys, ['event:10'])
})

test('a historical anchor is retained instead of projecting a later room backwards', () => {
  const state = stepActivityCues(emptyCueState(), [entry({ x: 80, y: 90, roomId: 2 })], 1_000)
  assert.deepEqual(cueFrame(state, 1_500)[0]?.anchor, { x: 80, y: 90, roomId: 2 })
})

test('looking uses an eight by five eye with a pupil and expires at the public boundary', () => {
  const first = stepActivityCues(emptyCueState(), [entry({ key: 'looking:7:3:a', cue: 'looking', expiresAt: 2_500 })], 1_000)
  const refreshed = stepActivityCues(first, [entry({ key: 'looking:7:3:a', cue: 'looking', expiresAt: 2_500 })], 2_000)
  const cells = cueFrame(refreshed, 2_000)[0]!.cells
  assert.equal(Math.max(...cells.map(([x]) => x)), 7)
  assert.equal(Math.max(...cells.map(([, y]) => y)), 4)
  assert(cells.some(([x, y]) => x === 3 && y === 2) && cells.some(([x, y]) => x === 4 && y === 2))
  assert.equal(cueFrame(refreshed, 2_500).length, 0)
})

test('common cue categories use distinct readable pixel motifs', () => {
  const cues = ['note', 'home', 'rules', 'wait', 'failed', 'change', 'trade', 'use', 'consume', 'effect', 'move'] as const
  const state = stepActivityCues(emptyCueState(), cues.map((cue, index) => entry({ key: cue, cue, residentId: index + 1 })), 1_000)
  assert.equal(new Set(cueFrame(state, 1_000).map(frame => JSON.stringify(frame.cells))).size, cues.length)
  assert(cueFrame(state, 1_000).filter(frame => frame.cue === 'effect' || frame.cue === 'move')
    .every(frame => frame.cells.length > 4))
})
