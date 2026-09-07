import type { ReplayEvent } from '../city/types.ts'

export type Clock = Readonly<{
  time: number
  start: number
  end: number
  speed: number
  paused: boolean
}>

export type AppliedMove = Readonly<{ fromId: number; toId: number }>

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

export function dueEvents(
  timeline: readonly ReplayEvent[],
  cursor: number,
  time: number,
): { events: readonly ReplayEvent[]; cursor: number } {
  const ordered = timeline
    .map((item, originalIndex) => ({ item, originalIndex, time: Date.parse(item.at) }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.time) ? left.time : Number.POSITIVE_INFINITY
      const rightTime = Number.isFinite(right.time) ? right.time : Number.POSITIVE_INFINITY
      return leftTime - rightTime || left.originalIndex - right.originalIndex
    })
  const safeCursor = Math.min(timeline.length, Math.max(0, Math.floor(Number.isFinite(cursor) ? cursor : 0)))
  if (!Number.isFinite(time)) return { events: [], cursor: safeCursor }

  let nextCursor = safeCursor
  while (nextCursor < ordered.length && ordered[nextCursor]!.time <= time) nextCursor += 1

  return {
    events: ordered.slice(safeCursor, nextCursor).map(({ item }) => item),
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
