import type { ReplayEvent } from './city/types.ts'
import type { NestedLayout } from './ground/nested.ts'
import { roomIsPublic } from './room-view.ts'

// Only change IDs beyond the cursor belong to this open view;
// browser time never substitutes for the server cursor.
export function eventsAfterMarker(events: readonly ReplayEvent[], deliveredMarker: number): readonly ReplayEvent[] {
  const seen = new Set<string>()
  return Object.freeze(events.filter(event => {
    const id = Number(event.change_id)
    if (!Number.isSafeInteger(id) || id <= deliveredMarker || seen.has(event.change_id)) return false
    seen.add(event.change_id)
    return true
  }).sort((left, right) => Number(left.change_id) - Number(right.change_id)))
}

/** The city window's own rough-room sentence (city PR #359), kept word for word. */
export const ROUGH_ROOM_LINE =
  'Rough room: things that wake here may hold or send home a resident who came in after its owner marked it rough. Going home is never blocked.'

/** The header mark for the shown room. Only a place read that said rough_room true marks it. */
export function roomMark(rough: boolean | undefined): Readonly<{ text: string; title: string }> | null {
  return rough === true ? Object.freeze({ text: 'rough room', title: ROUGH_ROOM_LINE }) : null
}

export type OutlineResolution = 'pending' | 'merged' | 'unmergeable'

export function roomPictureAccess(layout: NestedLayout | undefined, roomId: number | null,
  hiddenContents: ReadonlySet<number>): Readonly<{ quiet: boolean; needsOutline: boolean }> {
  const exists = roomId !== null && Boolean(layout?.rooms[roomId])
  const publicRoom = exists && roomIsPublic(layout!, roomId!)
  return Object.freeze({ quiet: exists && !publicRoom, needsOutline: publicRoom && !hiddenContents.has(roomId!) })
}

export function roomPictureSettled(state: { ready: boolean; firstPollMerged: boolean; needsOutline: boolean;
  outline: OutlineResolution; pendingReads: number; pendingOutline: boolean }): boolean {
  return state.ready && state.firstPollMerged && (!state.needsOutline || state.outline !== 'pending')
    && state.pendingReads === 0 && !state.pendingOutline
}

export function animationDelta(delta: number, state: {
  ready: boolean
  readFailed: boolean
}): number {
  if (!Number.isFinite(delta) || !state.ready || state.readFailed) return 0
  return Math.max(0, delta)
}

export function roomStatus(state: { tooSmall: boolean; readFailed: boolean; quiet: boolean;
  quietOwner?: { name: string; owner: string | null; self: boolean } | null;
  openingNotice?: string | null; readIssue?: string }): string {
  const status = state.tooSmall ? 'This window is too small to draw the room.'
    : state.readFailed ? 'The public record could not be read. Keeping the last picture and retrying.'
    : state.quiet ? state.quietOwner
      ? state.quietOwner.self
        ? `${state.quietOwner.owner ?? 'The owner'} prefers to keep this room private.`
        : `This place is inside ${state.quietOwner.name}, which ${state.quietOwner.owner ?? 'its owner'} prefers to keep private.`
      : 'This is a quiet place; its occupants are not shown.' : state.readIssue ?? ''
  return [state.openingNotice, status].filter(Boolean).join(' ')
}
