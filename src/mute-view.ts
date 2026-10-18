import { nearestPlaceChoice, type MutePlace, type MuteRules } from './browser-mutes.ts'

/** The window says the same words in each list it shortens (city step 2, PR 11). */
export const MUTE_COUNT_WORDS = 'hidden by your mutes in this browser'

export type MutedRoom = Readonly<{ name: string; self: boolean }>

/** Which place hides the shown room, when the browser's list hides it. */
export function mutedRoom(rules: MuteRules, places: readonly (MutePlace & Readonly<{ name: string }>)[],
  roomId: number | null): MutedRoom | null {
  if (roomId === null || rules.places.size === 0) return null
  const byId = new Map(places.map(place => [place.id, place]))
  const nearest = nearestPlaceChoice(rules, byId, roomId)
  if (nearest?.choice !== 'mute') return null
  return Object.freeze({ name: byId.get(nearest.placeId)?.name ?? `place #${String(nearest.placeId)}`, self: nearest.placeId === roomId })
}

/** The status words for the browser's list: a hidden room, or a count of what it hid here. */
export function muteStatus(state: Readonly<{ room: MutedRoom | null; hiddenCount: number }>): string {
  if (state.room) {
    return state.room.self ? `This place is ${MUTE_COUNT_WORDS}.`
      : `This place is inside ${state.room.name}, which is ${MUTE_COUNT_WORDS}.`
  }
  return state.hiddenCount > 0 ? `${String(state.hiddenCount)} ${MUTE_COUNT_WORDS}.` : ''
}

/**
 * The status line with the mute words added. A small window, a failed read, or a quiet
 * room keeps its own sentence alone, exactly as before.
 */
export function statusWithMutes(status: string, mute: string,
  state: Readonly<{ tooSmall: boolean; readFailed: boolean; quiet: boolean }>): string {
  if (state.tooSmall || state.readFailed || state.quiet || !mute) return status
  return [status, mute].filter(Boolean).join(' ')
}

type CountedResident = Readonly<{ id: number; placeId: number | null }>
type CountedThing = Readonly<{ id: number; placeId: number }>

/** How many residents and things in the shown room the list hides right now. */
export function hiddenInRoom(roomId: number | null, residents: readonly CountedResident[], things: readonly CountedThing[],
  hidden: Readonly<{ resident: (id: number) => boolean; thing: (thing: CountedThing) => boolean }>): number {
  if (roomId === null) return 0
  return residents.filter(row => row.placeId === roomId && hidden.resident(row.id)).length
    + things.filter(row => row.placeId === roomId && hidden.thing(row)).length
}
