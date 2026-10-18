import { hiddenByMutes, type MuteRules } from './browser-mutes.ts'

/** The window says the same words in each list it shortens (city step 2, PR 11). */
export const MUTE_COUNT_WORDS = 'hidden by your mutes in this browser'

/** The status words for the browser's list: how many things it hid in the shown room. */
export function muteStatus(hiddenCount: number): string {
  return hiddenCount > 0 ? `${String(hiddenCount)} ${MUTE_COUNT_WORDS}.` : ''
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

type ShownPlace = Readonly<{ id: number; owner_id: number | null }>

/**
 * Whether the list hides the shown room's own drawing. A hidden place is still drawn as a
 * room, so both founders and anything allowed can stand in it; only a place a founder
 * owns keeps its drawing under a mute.
 */
export function roomDrawingHidden(rules: MuteRules, rooms: ReadonlySet<number>, place: ShownPlace | undefined): boolean {
  return Boolean(place && !rules.empty && hiddenByMutes({ type: 'place', id: place.id, owner_id: place.owner_id }, rules, rooms))
}

type CountedResident = Readonly<{ id: number; placeId: number | null }>
type CountedThing = Readonly<{ id: number; placeId: number }>

/** How many residents and things in the shown room the list hides right now, and its drawing. */
export function hiddenInRoom(roomId: number | null, residents: readonly CountedResident[], things: readonly CountedThing[],
  hidden: Readonly<{ resident: (id: number) => boolean; thing: (thing: CountedThing) => boolean; drawing?: boolean }>): number {
  if (roomId === null) return 0
  return residents.filter(row => row.placeId === roomId && hidden.resident(row.id)).length
    + things.filter(row => row.placeId === roomId && hidden.thing(row)).length + (hidden.drawing ? 1 : 0)
}
