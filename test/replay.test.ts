import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ReplayEvent, ReplayFile } from '../src/city/types.ts'
import {
  BASE_SPEED,
  advanceClock,
  appliedMove,
  bubbleDuration,
  bubbleFor,
  bubbleVisible,
  chosenSpeed,
  createClock,
  dueEvents,
  holdScale,
  prepareTimeline,
  walkDuration,
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

test('clock starts at the replay window and advances at replay speed', () => {
  const clock = createClock('2026-09-07T00:00:00.000Z', '2026-09-07T00:01:00.000Z')
  const advanced = advanceClock(clock, 250)

  assert.equal(clock.time, clock.start)
  assert.equal(clock.speed, 120)
  assert.equal(advanced.time, clock.start + 30_000)
  assert.notEqual(advanced, clock)
})

test('clock clamps at the end and ignores unusable elapsed time', () => {
  const clock = createClock('2026-09-07T00:00:00.000Z', '2026-09-07T00:00:10.000Z', 2)

  assert.equal(advanceClock(clock, 6_000).time, clock.end)
  assert.deepEqual(advanceClock(clock, -1), clock)
  assert.deepEqual(advanceClock(clock, Number.NaN), clock)
  assert.deepEqual(advanceClock({ ...clock, paused: true }, 1_000), { ...clock, paused: true })
})

test('clock rejects invalid windows and speed', () => {
  assert.throws(() => createClock('bad', '2026-09-07T00:00:00.000Z'), RangeError)
  assert.throws(
    () => createClock('2026-09-07T00:00:01.000Z', '2026-09-07T00:00:00.000Z'),
    RangeError,
  )
  assert.throws(
    () => createClock('2026-09-07T00:00:00.000Z', '2026-09-07T00:00:01.000Z', 0),
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

test('bubble keeps the recorded note line and cut flag for five replay seconds', () => {
  const note = event({ kind: 'note', line: 'first line\nsecond line', line_cut: true })
  const bubble = bubbleFor(note, 10_000)

  assert.deepEqual(bubble, { text: 'first line\nsecond line', cut: true, expiresAt: 15_000 })
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

test('hold lengths shrink with the chosen speed and stop at a floor', () => {
  assert.equal(holdScale(BASE_SPEED), 1)
  assert.equal(holdScale(60), 2)
  assert.equal(holdScale(300), 0.4)
  assert.equal(holdScale(0), 1)
  assert.equal(holdScale(Number.NaN), 1)

  assert.equal(bubbleDuration(BASE_SPEED), 5_000)
  assert.equal(bubbleDuration(60), 10_000)
  assert.equal(bubbleDuration(300), 2_000)
  assert.equal(bubbleDuration(100_000), 1_500)

  assert.equal(walkDuration(0, BASE_SPEED), 1_200)
  assert.equal(walkDuration(600, BASE_SPEED), 3_000)
  assert.equal(walkDuration(5_000, BASE_SPEED), 4_000)
  assert.equal(walkDuration(600, 60), 6_000)
  assert.equal(walkDuration(600, 300), 1_200)
  assert.equal(walkDuration(0, 300), 480)
  assert.equal(walkDuration(0, 100_000), 400)
})

test('a faster speed shortens every hold and never inverts the order of the speeds', () => {
  const speeds = [60, BASE_SPEED, 300]
  const holds = speeds.map(speed => bubbleDuration(speed) + walkDuration(0, speed) + walkDuration(900, speed))
  assert.deepEqual([...holds].sort((left, right) => right - left), holds)
  assert.ok(holds[2]! < holds[1]!)
  assert.ok(holds[1]! < holds[0]!)
})

test('a bubble expires sooner at a faster speed and keeps its recorded words', () => {
  const note = event({ kind: 'note', line: 'a word' })
  assert.equal(bubbleFor(note, 10_000)!.expiresAt, 15_000)
  assert.equal(bubbleFor(note, 10_000, 300)!.expiresAt, 12_000)
  assert.equal(bubbleFor(note, 10_000, 60)!.expiresAt, 20_000)
  assert.equal(bubbleFor(note, 10_000, 300)!.text, 'a word')
})

test('the speed box reading takes any positive number the page offers', () => {
  assert.equal(chosenSpeed('60'), 60)
  assert.equal(chosenSpeed('120'), 120)
  assert.equal(chosenSpeed('300'), 300)
  assert.equal(chosenSpeed(' 300 '), 300)
  assert.equal(chosenSpeed('2.5'), 2.5)
})

test('a missing speed box falls back to the speed the page starts at', () => {
  assert.equal(chosenSpeed(null), BASE_SPEED)
  assert.equal(chosenSpeed(undefined), BASE_SPEED)
})

test('an empty or nonsense speed box falls back to the speed the page starts at', () => {
  assert.equal(chosenSpeed(''), BASE_SPEED)
  assert.equal(chosenSpeed('   '), BASE_SPEED)
  assert.equal(chosenSpeed('fast'), BASE_SPEED)
  assert.equal(chosenSpeed('12x'), BASE_SPEED)
  assert.equal(chosenSpeed('Infinity'), BASE_SPEED)
})

test('a zero or negative speed box falls back to the speed the page starts at', () => {
  assert.equal(chosenSpeed('0'), BASE_SPEED)
  assert.equal(chosenSpeed('-120'), BASE_SPEED)
})
