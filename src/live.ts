import type { ReplayEvent } from './city/types.ts'
import type { NestedLayout } from './ground/nested.ts'

export type LiveReadState = Readonly<{
  marker: string
  seen: ReadonlySet<string>
  failures: number
  lastReadAt: number | null
  retryMs?: number
}>

const POLL_MS = 30_000
const MAX_RETRY_MS = 120_000

export function liveNoteReferences(events: readonly ReplayEvent[], layout: NestedLayout):
  readonly Readonly<{ event: ReplayEvent; index: number }>[] {
  return events.map((event, index) => ({ event, index })).filter(({ event }) => {
    const id = event.detail.note_id
    const placeId = event.detail.place_id
    if (event.kind !== 'note' || !Number.isSafeInteger(id) || (id as number) <= 0
      || typeof placeId !== 'number' || !layout.rooms[placeId]) return false
    let room: NestedLayout['rooms'][number] | undefined = layout.rooms[placeId]
    while (room) {
      if (room.quiet) return false
      room = room.parentId === null ? undefined : layout.rooms[room.parentId]
    }
    return true
  })
}

export function newLiveEvents(state: LiveReadState, events: readonly ReplayEvent[]): readonly ReplayEvent[] {
  const committed = numericId(state.marker)
  return [...events].filter(event => numericId(event.change_id) > committed && !state.seen.has(event.change_id))
    .sort((a, b) => numericId(a.change_id) - numericId(b.change_id))
}

export function liveReadSucceeded(
  state: LiveReadState, marker: string, events: readonly ReplayEvent[], readAt: number,
): LiveReadState {
  const seen = new Set(state.seen)
  for (const event of events) seen.add(event.change_id)
  return Object.freeze({ marker, seen, failures: 0, lastReadAt: readAt, retryMs: POLL_MS })
}

export function liveReadFailed(state: LiveReadState): LiveReadState {
  const failures = state.failures + 1
  return Object.freeze({ ...state, failures, retryMs: Math.min(MAX_RETRY_MS, POLL_MS * 2 ** (failures - 1)) })
}

export function validContinuation(current: string, next: string, hasMore: boolean): boolean {
  const before = numericId(current)
  const after = numericId(next)
  return after >= before && (!hasMore || after > before)
}

function numericId(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

