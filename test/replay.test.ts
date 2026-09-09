import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ReplayEvent, ReplayFile } from '../src/city/types.ts'
import {
  advanceClock,
  appliedMove,
  bubbleDuration,
  bubbleFor,
  bubbleVisible,
  createClock,
  dueEvents,
  prepareTimeline,
  walkDuration,
  walkProgress,
} from '../src/replay/index.ts'

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
  const clock = createClock('2026-09-07T00:00:00.000Z', '2026-09-07T00:01:00.000Z')
  const advanced = advanceClock(clock, 250)

  assert.equal(clock.time, clock.start)
  assert.deepEqual(Object.keys(clock).sort(), ['end', 'start', 'time'])
  assert.equal(advanced.time, clock.start + 250)
  assert.notEqual(advanced, clock)
})

test('clock clamps at the end and ignores unusable elapsed time', () => {
  const clock = createClock('2026-09-07T00:00:00.000Z', '2026-09-07T00:00:10.000Z')

  assert.equal(advanceClock(clock, 11_000).time, clock.end)
  assert.deepEqual(advanceClock(clock, -1), clock)
  assert.deepEqual(advanceClock(clock, Number.NaN), clock)
})

test('clock rejects invalid windows', () => {
  assert.throws(() => createClock('bad', '2026-09-07T00:00:00.000Z'), RangeError)
  assert.throws(
    () => createClock('2026-09-07T00:00:01.000Z', '2026-09-07T00:00:00.000Z'),
    RangeError,
  )
})

test('due events include the first row once and preserve order for equal timestamps', () => {
  const timeline = [
    event({ event_id: 3, at: '2026-09-07T00:00:02.000Z' }),
    event({ event_id: 1, at: '2026-09-07T00:00:00.000Z' }),
    event({ event_id: 2, at: '2026-09-07T00:00:00.000Z' }),
  ]
  const prepared = prepareTimeline(timeline)
  const first = dueEvents(prepared, 0, Date.parse('2026-09-07T00:00:00.000Z'))
  const second = dueEvents(prepared, first.cursor, Date.parse('2026-09-07T00:00:00.000Z'))
  const last = dueEvents(prepared, second.cursor, Date.parse('2026-09-07T00:00:03.000Z'))

  assert.deepEqual(first.events.map(({ event_id }) => event_id), [1, 2])
  assert.deepEqual(second.events, [])
  assert.deepEqual(last.events.map(({ event_id }) => event_id), [3])
  assert.equal(last.cursor, 3)
})

test('due events tolerate cursor and time outside their useful ranges', () => {
  const timeline = prepareTimeline([event()])
  assert.deepEqual(dueEvents(timeline, -20, Number.NaN), { events: [], cursor: 0 })
  assert.deepEqual(dueEvents(timeline, 20, Date.now()), { events: [], cursor: 1 })
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
  assert.equal(bubbleVisible(15_000, 14_999), true)
  assert.equal(bubbleVisible(15_000, 15_000), false)
  assert.equal(bubbleFor(event({ kind: 'note', line: '' }), 0), null)
  assert.equal(bubbleFor(event({ kind: 'action', line: 'not a note' }), 0), null)
})

test('real replay fixture exposes moves, noops, notes, gaps, and window clamping', () => {
  const replay = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
  const moves = replay.timeline.map(appliedMove).filter((move) => move !== null)
  const noops = replay.timeline.filter(({ detail }) => detail.status === 'noop')
  const notes = replay.timeline.map((item) => bubbleFor(item, Date.parse(item.at))).filter((bubble) => bubble !== null)
  const all = dueEvents(prepareTimeline(replay.timeline), 0, Date.parse(replay.window_end))
  const clock = advanceClock(createClock(replay.window_start, replay.window_end), 86_400_000)

  assert.ok(moves.length > 0)
  assert.ok(noops.length > 0)
  assert.ok(notes.length > 0)
  assert.ok(replay.timeline.some((item, index) => index > 0 && Date.parse(item.at) - Date.parse(replay.timeline[index - 1]!.at) > 1_000))
  assert.equal(all.cursor, replay.timeline.length)
  assert.equal(clock.time, Date.parse(replay.window_end))
})

test('the timeline is sorted and read once, with unreadable times left until last', () => {
  const rows = prepareTimeline([
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
  assert.deepEqual(prepareTimeline([]), [])
  assert.deepEqual(dueEvents(rows, 0, Date.parse('2026-09-07T00:00:02.000Z')).events.map(item => item.event_id), [1, 2, 3])
})

test('fixed speech holds stay readable with a bounded total lifetime', () => {
  assert.equal(bubbleDuration(), 10_000)
  assert.equal(bubbleDuration(100), 11_800)
  assert.equal(bubbleDuration(100_000), 15_000)
})

test('offline route durations use one fixed timing rule', () => {
  assert.equal(walkDuration(0), 5_600)
  assert.equal(walkDuration(1_000), 5_600)
  assert.equal(walkDuration(16_000), 6_800)
  assert.equal(walkDuration(1_000_000), 8_000)
})

test('walk pace spends visible time near each room and accelerates only the far middle', () => {
  const distance = 10_000
  assert.equal(walkProgress(distance, 0), 0)
  assert.ok(walkProgress(distance, 0.2) < 0.01)
  assert.ok(walkProgress(distance, 0.5) > 0.4)
  assert.ok(walkProgress(distance, 0.8) > 0.99)
  assert.equal(walkProgress(distance, 1), 1)
  assert.equal(walkProgress(100, 0.5), 0.5)
  const doors = [0, 2_000, 8_000, distance]
  assert.ok(walkProgress(distance, 0.25, doors) < 0.21)
  assert.ok(walkProgress(distance, 0.75, doors) > 0.79)
})
