import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ReplayEvent, ReplayFile } from '../src/city/types.ts'
import { appliedMove } from '../src/replay/index.ts'
import { bubbleDuration, bubbleFor } from '../src/speech.ts'
import { advanceSceneClock, createSceneClock, dueSceneEvents, prepareSceneTimeline } from './helpers/recorded-scene.ts'

const event = (overrides: Partial<ReplayEvent> = {}): ReplayEvent => ({
  actor: 'walker',
  at: '2026-09-07T00:00:01.000Z',
  change_id: '1',
  event_id: 1,
  kind: 'action',
  detail: {},
  ...overrides,
})

test('offline fixture clock advances one millisecond per elapsed millisecond', () => {
  const clock = createSceneClock('2026-09-07T00:00:00.000Z', '2026-09-07T00:01:00.000Z')
  const advanced = advanceSceneClock(clock, 250)

  assert.equal(clock.time, clock.start)
  assert.deepEqual(Object.keys(clock).sort(), ['end', 'start', 'time'])
  assert.equal(advanced.time, clock.start + 250)
  assert.notEqual(advanced, clock)
})

test('clock clamps at the end and ignores unusable elapsed time', () => {
  const clock = createSceneClock('2026-09-07T00:00:00.000Z', '2026-09-07T00:00:10.000Z')

  assert.equal(advanceSceneClock(clock, 11_000).time, clock.end)
  assert.deepEqual(advanceSceneClock(clock, -1), clock)
  assert.deepEqual(advanceSceneClock(clock, Number.NaN), clock)
})

test('clock rejects invalid windows', () => {
  assert.throws(() => createSceneClock('bad', '2026-09-07T00:00:00.000Z'), RangeError)
  assert.throws(
    () => createSceneClock('2026-09-07T00:00:01.000Z', '2026-09-07T00:00:00.000Z'),
    RangeError,
  )
})

test('due events include the first row once and preserve order for equal timestamps', () => {
  const timeline = [
    event({ event_id: 3, at: '2026-09-07T00:00:02.000Z' }),
    event({ event_id: 1, at: '2026-09-07T00:00:00.000Z' }),
    event({ event_id: 2, at: '2026-09-07T00:00:00.000Z' }),
  ]
  const prepared = prepareSceneTimeline(timeline)
  const first = dueSceneEvents(prepared, 0, Date.parse('2026-09-07T00:00:00.000Z'))
  const second = dueSceneEvents(prepared, first.cursor, Date.parse('2026-09-07T00:00:00.000Z'))
  const last = dueSceneEvents(prepared, second.cursor, Date.parse('2026-09-07T00:00:03.000Z'))

  assert.deepEqual(first.events.map(({ event_id }) => event_id), [1, 2])
  assert.deepEqual(second.events, [])
  assert.deepEqual(last.events.map(({ event_id }) => event_id), [3])
  assert.equal(last.cursor, 3)
})

test('due events tolerate cursor and time outside their useful ranges', () => {
  const timeline = prepareSceneTimeline([event()])
  assert.deepEqual(dueSceneEvents(timeline, -20, Number.NaN), { events: [], cursor: 0 })
  assert.deepEqual(dueSceneEvents(timeline, 20, Date.now()), { events: [], cursor: 1 })
})

test('appliedMove accepts only real applied move and go_home endpoints', () => {
  const valid = event({ detail: { action: 'move', status: 'applied', from_place_id: 10, to_place_id: 20 } })
  const home = event({ detail: { action: 'go_home', status: 'applied', from_place_id: 20, to_place_id: 30 } })

  assert.deepEqual(appliedMove(valid), { fromId: 10, toId: 20 })
  assert.deepEqual(appliedMove(home), { fromId: 20, toId: 30 })
  assert.equal(appliedMove(event({ detail: { ...valid.detail, status: 'noop' } })), null)
  assert.equal(appliedMove(event({ detail: { ...valid.detail, from_place_id: 10, to_place_id: 10 } })), null)
  assert.equal(appliedMove(event({ kind: 'note', detail: valid.detail })), null)
})

test('bubble keeps the recorded note line, cut flag, start, and room for its readable hold', () => {
  const note = event({ kind: 'note', line: 'first line\nsecond line', line_cut: true })
  const bubble = bubbleFor(note, 10_000)

  assert.deepEqual(bubble, { text: 'first line\nsecond line', cut: true, placeId: null,
    startedAt: 10_000, charInterval: 68, expiresAt: 20_000 })
  assert.equal(bubbleFor(event({ kind: 'note', line: '' }), 0), null)
  assert.equal(bubbleFor(event({ kind: 'action', line: 'not a note' }), 0), null)
})

test('real replay fixture exposes moves, noops, notes, gaps, and window clamping', () => {
  const replay = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
  const moves = replay.timeline.map(appliedMove).filter((move) => move !== null)
  const noops = replay.timeline.filter(({ detail }) => detail.status === 'noop')
  const notes = replay.timeline.map((item) => bubbleFor(item, Date.parse(item.at))).filter((bubble) => bubble !== null)
  const all = dueSceneEvents(prepareSceneTimeline(replay.timeline), 0, Date.parse(replay.window_end))
  const clock = advanceSceneClock(createSceneClock(replay.window_start, replay.window_end), 86_400_000)

  assert.ok(moves.length > 0)
  assert.ok(noops.length > 0)
  assert.ok(notes.length > 0)
  assert.ok(replay.timeline.some((item, index) => index > 0 && Date.parse(item.at) - Date.parse(replay.timeline[index - 1]!.at) > 1_000))
  assert.equal(all.cursor, replay.timeline.length)
  assert.equal(clock.time, Date.parse(replay.window_end))
})

test('the timeline is sorted and read once, with unreadable times left until last', () => {
  const rows = prepareSceneTimeline([
    event({ event_id: 3, at: '2026-09-07T00:00:02.000Z' }),
    event({ event_id: 9, at: 'not a time' }),
    event({ event_id: 1, at: '2026-09-07T00:00:00.000Z' }),
    event({ event_id: 2, at: '2026-09-07T00:00:00.000Z' }),
  ])

  assert.deepEqual(rows.map(({ event: item }) => item.event_id), [1, 2, 3, 9])
  assert.deepEqual(rows.map(({ time }) => time), [
    Date.parse('2026-09-07T00:00:00.000Z'),
    Date.parse('2026-09-07T00:00:00.000Z'),
    Date.parse('2026-09-07T00:00:02.000Z'),
    Number.POSITIVE_INFINITY,
  ])
  assert.deepEqual(prepareSceneTimeline([]), [])
  assert.deepEqual(dueSceneEvents(rows, 0, Date.parse('2026-09-07T00:00:02.000Z')).events.map(item => item.event_id), [1, 2, 3])
})

test('fixed speech holds stay readable with a bounded total lifetime', () => {
  assert.equal(bubbleDuration(), 10_000)
  assert.equal(bubbleDuration(100), 11_800)
  assert.equal(bubbleDuration(100_000), 15_000)
})

