import type { ReplayEvent } from '../city/types.ts'

export type Clock = Readonly<{
  time: number
  start: number
  end: number
  speed: number
  paused: boolean
}>

export type AppliedMove = Readonly<{ fromId: number; toId: number }>

export type TimelineRow = Readonly<{ event: ReplayEvent; time: number }>

export type Bubble = Readonly<{
  text: string
  cut: boolean
  expiresAt: number
}>

// The clock runs fast between recorded moments and stands still while a figure walks
// or a word is up. Those holds are most of what the saved day costs, so they shrink with
// the chosen speed and stop shrinking at a floor that keeps a walk visible and a line readable.
export const BASE_SPEED = 120
const BUBBLE_DURATION_MS = 5_000
const BUBBLE_FLOOR_MS = 1_500
const WALK_SHORTEST_MS = 1_200
const WALK_LONGEST_MS = 4_000
const WALK_FLOOR_MS = 400

// The speed box is read as plain text, so a missing, empty or nonsense value never throws:
// anything that is not a positive number falls back to the speed the page starts at.
export function chosenSpeed(value: string | null | undefined): number {
  if (typeof value !== 'string' || value.trim().length === 0) return BASE_SPEED
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : BASE_SPEED
}

export function holdScale(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1
  return BASE_SPEED / speed
}

export function walkDuration(distance: number, speed: number = BASE_SPEED): number {
  const paced = Number.isFinite(distance) && distance > 0 ? distance * 5 : 0
  const base = Math.min(WALK_LONGEST_MS, Math.max(WALK_SHORTEST_MS, paced))
  return Math.max(WALK_FLOOR_MS, base * holdScale(speed))
}

export function bubbleDuration(speed: number = BASE_SPEED): number {
  return Math.max(BUBBLE_FLOOR_MS, BUBBLE_DURATION_MS * holdScale(speed))
}

export function createClock(start: string, end: string, speed: number = BASE_SPEED): Clock {
  const startTime = Date.parse(start)
  const endTime = Date.parse(end)

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    throw new RangeError('Replay window must contain valid dates in chronological order')
  }
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new RangeError('Replay speed must be a positive finite number')
  }

  return { time: startTime, start: startTime, end: endTime, speed, paused: false }
}

export function advanceClock(clock: Clock, deltaMs: number): Clock {
  if (clock.paused || !Number.isFinite(deltaMs) || deltaMs < 0) return clock

  return {
    ...clock,
    time: Math.min(clock.end, clock.time + deltaMs * clock.speed),
  }
}

// Sort and read every recorded time once, when the replay loads, so each frame only walks a cursor.
export function prepareTimeline(timeline: readonly ReplayEvent[]): readonly TimelineRow[] {
  const rows = timeline
    .map((event, originalIndex) => ({
      event,
      originalIndex,
      time: Number.isFinite(Date.parse(event.at)) ? Date.parse(event.at) : Number.POSITIVE_INFINITY,
    }))
    .sort((left, right) => left.time - right.time || left.originalIndex - right.originalIndex)
    .map(({ event, time }) => Object.freeze({ event, time }))
  return Object.freeze(rows)
}

export function dueEvents(
  timeline: readonly TimelineRow[],
  cursor: number,
  time: number,
): { events: readonly ReplayEvent[]; cursor: number } {
  const safeCursor = Math.min(timeline.length, Math.max(0, Math.floor(Number.isFinite(cursor) ? cursor : 0)))
  if (!Number.isFinite(time)) return { events: [], cursor: safeCursor }

  let nextCursor = safeCursor
  while (nextCursor < timeline.length && timeline[nextCursor]!.time <= time) nextCursor += 1

  return {
    events: timeline.slice(safeCursor, nextCursor).map(({ event }) => event),
    cursor: nextCursor,
  }
}

export function appliedMove(event: ReplayEvent): AppliedMove | null {
  const { action, status, from_place_id: fromId, to_place_id: toId } = event.detail
  if (event.kind !== 'action' || (action !== 'move' && action !== 'go_home') || status !== 'applied') {
    return null
  }
  if (!isPlaceId(fromId) || !isPlaceId(toId) || fromId === toId) return null

  return { fromId, toId }
}

export function bubbleFor(event: ReplayEvent, shownAt: number, speed: number = BASE_SPEED): Bubble | null {
  if (event.kind !== 'note' || typeof event.line !== 'string' || event.line.length === 0) return null
  if (!Number.isFinite(shownAt)) return null

  return {
    text: event.line,
    cut: event.line_cut === true,
    expiresAt: shownAt + bubbleDuration(speed),
  }
}

export function bubbleVisible(expiresAt: number, now: number): boolean {
  return Number.isFinite(expiresAt) && Number.isFinite(now) && now < expiresAt
}

function isPlaceId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
