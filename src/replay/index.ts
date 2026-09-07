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

const BUBBLE_DURATION_MS = 5_000

export function createClock(start: string, end: string, speed = 120): Clock {
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

export function bubbleFor(event: ReplayEvent, shownAt: number): Bubble | null {
  if (event.kind !== 'note' || typeof event.line !== 'string' || event.line.length === 0) return null
  if (!Number.isFinite(shownAt)) return null

  return {
    text: event.line,
    cut: event.line_cut === true,
    expiresAt: shownAt + BUBBLE_DURATION_MS,
  }
}

export function bubbleVisible(expiresAt: number, now: number): boolean {
  return Number.isFinite(expiresAt) && Number.isFinite(now) && now < expiresAt
}

function isPlaceId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
