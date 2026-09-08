import type { ReplayEvent } from './city/types.ts'

// Census pages have no per-resident change marker. Only the replay/delivered change ID
// proves a row is already covered; elapsed browser time can never prove that.
export function eventsAfterMarker(events: readonly ReplayEvent[], deliveredMarker: number): readonly ReplayEvent[] {
  const seen = new Set<string>()
  return Object.freeze(events.filter(event => {
    const id = Number(event.change_id)
    if (!Number.isSafeInteger(id) || id <= deliveredMarker || seen.has(event.change_id)) return false
    seen.add(event.change_id)
    return true
  }).sort((left, right) => Number(left.change_id) - Number(right.change_id)))
}

export function roomPictureSettled(state: { ready: boolean; firstPollMerged: boolean; needsOutline: boolean;
  outlineMerged: boolean; pendingReads: number; pendingOutline: boolean }): boolean {
  return state.ready && state.firstPollMerged && (!state.needsOutline || state.outlineMerged)
    && state.pendingReads === 0 && !state.pendingOutline
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
