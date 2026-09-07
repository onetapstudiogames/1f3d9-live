import type { ReplayEvent } from './city/types.ts'
import { appliedMove } from './replay/index.ts'

export type DirectorActivity = Readonly<{ changeId: string; placeId: number }>
export type DirectorState = Readonly<{ roomId: number | null; nextAt: number }>
export type DirectorStep = Readonly<DirectorState & { changed: boolean; waiting: boolean }>

const WINDOW_MS = 5 * 60_000
export const DIRECTOR_LINGER_MS = 8_000

export function directorActivity(events: readonly ReplayEvent[], recordedNow: number,
  windowMs = WINDOW_MS): readonly DirectorActivity[] {
  if (!Number.isFinite(recordedNow) || !Number.isFinite(windowMs) || windowMs < 0) return []
  const seen = new Set<string>(); const activity: DirectorActivity[] = []
  for (const event of events) {
    if (seen.has(event.change_id)) continue
    seen.add(event.change_id)
    const time = Date.parse(event.at)
    if (!Number.isFinite(time) || time < recordedNow - windowMs || time > recordedNow) continue
    const placeId = activityPlace(event)
    if (placeId !== null) activity.push(Object.freeze({ changeId: event.change_id, placeId }))
  }
  return Object.freeze(activity)
}

export function rankDirectorRooms(activity: readonly DirectorActivity[], known: ReadonlySet<number>,
  hidden: ReadonlySet<number>): readonly number[] {
  const scores = new Map<number, number>()
  for (const item of activity) if (known.has(item.placeId) && !hidden.has(item.placeId))
    scores.set(item.placeId, (scores.get(item.placeId) ?? 0) + 1)
  return Object.freeze([...scores].sort((left, right) => right[1] - left[1] || left[0] - right[0]).map(([id]) => id))
}

export function directorStep(state: DirectorState, ranked: readonly number[], now: number,
  lingerMs = DIRECTOR_LINGER_MS): DirectorStep {
  if (!ranked.length) return Object.freeze({ roomId: null, nextAt: now, changed: false, waiting: true })
  if (state.roomId !== null && ranked.includes(state.roomId) && now < state.nextAt)
    return Object.freeze({ ...state, changed: false, waiting: false })
  const index = state.roomId === null ? -1 : ranked.indexOf(state.roomId)
  const roomId = ranked[(index + 1) % ranked.length]!
  return Object.freeze({ roomId, nextAt: now + lingerMs, changed: roomId !== state.roomId, waiting: false })
}

function activityPlace(event: ReplayEvent): number | null {
  const detail = event.detail
  const move = appliedMove(event)
  if (move) return move.toId
  if (event.kind === 'note' && positive(detail.note_id) && positive(detail.place_id)) return detail.place_id!
  if (event.kind === 'thing_created' && positive(detail.thing_id) && positive(detail.place_id)
    && typeof detail.name === 'string' && detail.name.trim() && !detail.error) return detail.place_id!
  return null
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
