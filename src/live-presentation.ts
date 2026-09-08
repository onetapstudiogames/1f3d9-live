import type { ReplayEvent } from './city/types.ts'

export async function readCensusAtCompletion<T>(read: Promise<T>, now: () => number = Date.now): Promise<{
  census: T
  completedAt: number
}> {
  return read.then(census => Object.freeze({ census, completedAt: now() }))
}

export function eventsAfterCensus(events: readonly ReplayEvent[], completedAt: number): readonly ReplayEvent[] {
  return Object.freeze(events.filter(event => {
    const recordedAt = Date.parse(event.at)
    return Number.isFinite(recordedAt) && recordedAt > completedAt
  }))
}

export function animationDelta(delta: number, state: {
  ready: boolean
  paused: boolean
  jumping: boolean
  readFailed: boolean
  presenceLost: boolean
}): number {
  if (!Number.isFinite(delta) || !state.ready || state.paused || state.jumping) return 0
  return Math.min(100, Math.max(0, delta))
}

export function roomStatus(state: { tooSmall: boolean; readFailed: boolean; quiet: boolean }): string {
  if (state.tooSmall) return 'This window is too small to draw the room.'
  if (state.readFailed) return 'The public record could not be read. Keeping the last picture and retrying.'
  if (state.quiet) return 'This is a quiet place; its occupants are not shown.'
  return ''
}
