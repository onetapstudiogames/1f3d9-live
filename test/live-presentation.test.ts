import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayEvent } from '../src/city/types.ts'
import { animationDelta, eventsAfterCensus, readCensusAtCompletion, roomStatus } from '../src/live-presentation.ts'

const replayEvent = (changeId: string, at: string): ReplayEvent => ({
  actor: 'author', at, change_id: changeId, event_id: Number(changeId),
  kind: 'note', detail: { note_id: Number(changeId), place_id: 1 }, line: changeId, line_cut: false,
})

test('records census completion when its promise resolves independently of slower parallel work', async () => {
  let resolveCensus!: (value: { residents: number }) => void
  let resolveReplay!: () => void
  let clock = 10
  const censusRead = new Promise<{ residents: number }>(resolve => { resolveCensus = resolve })
  const replayRead = new Promise<void>(resolve => { resolveReplay = resolve })
  const resultPromise = readCensusAtCompletion(censusRead, () => clock)

  clock = 25
  resolveCensus({ residents: 3 })
  const result = await resultPromise
  clock = 90
  resolveReplay()
  await replayRead

  assert.deepEqual(result, { census: { residents: 3 }, completedAt: 25 })
})

test('keeps only events strictly after census completion and ignores invalid timestamps', () => {
  const events = [
    replayEvent('1', new Date(999).toISOString()),
    replayEvent('2', new Date(1_000).toISOString()),
    replayEvent('3', new Date(1_001).toISOString()),
    replayEvent('4', 'not-a-date'),
  ]

  assert.deepEqual(eventsAfterCensus(events, 1_000).map(event => event.change_id), ['3'])
})

test('clamps valid animation deltas while readiness, pause, and jump are the only gates', () => {
  const moving = { ready: true, paused: false, jumping: false, readFailed: false, presenceLost: false }
  assert.equal(animationDelta(40, moving), 40)
  assert.equal(animationDelta(-1, moving), 0)
  assert.equal(animationDelta(101, moving), 100)
  assert.equal(animationDelta(Number.NaN, moving), 0)
  assert.equal(animationDelta(40, { ...moving, ready: false }), 0)
  assert.equal(animationDelta(40, { ...moving, paused: true }), 0)
  assert.equal(animationDelta(40, { ...moving, jumping: true }), 0)
  assert.equal(animationDelta(40, { ...moving, readFailed: true, presenceLost: true }), 40)
})

test('chooses room status by size, read failure, then quiet priority', () => {
  assert.equal(roomStatus({ tooSmall: false, readFailed: false, quiet: false }), '')
  assert.equal(roomStatus({ tooSmall: false, readFailed: false, quiet: true }),
    'This is a quiet place; its occupants are not shown.')
  assert.equal(roomStatus({ tooSmall: false, readFailed: true, quiet: true }),
    'The public record could not be read. Keeping the last picture and retrying.')
  assert.equal(roomStatus({ tooSmall: true, readFailed: true, quiet: true }),
    'This window is too small to draw the room.')
})
