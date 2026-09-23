// The feed may carry null in either field, so both are read as unknown.
type AbilityDetail = Readonly<{ status?: unknown; mode?: unknown }>

// Room-log words for the city's ability records (city decisions #104 to #115, city PRs
// #359 and #360). The change feed keeps only reference fields: a chance roll carries its
// thing, room, and branch; a settle its room, what set it off, and whether anything woke;
// a state write, a copy, and a conversion their thing and room. Roll numbers, try counts,
// state values, and kind names stay on the city's own reads, so these words never claim them.

const SETTLE_TRIGGERS: Readonly<Record<string, string>> = Object.freeze({
  arrive: 'arrived', talk: 'spoke', act: 'acted', me: 'checked in',
})

/** A chance roll: `then` ran on a hit, `else` on a miss, and a wake pick has no branch. */
export function chanceRollWords(detail: AbilityDetail, thingName: string, roomName: string | null): string {
  const status = detail.status
  if (status === null && !thingName) {
    return roomName ? `set off a public roll that picked which things wake in ${roomName}` : 'set off a public roll that picked which things wake'
  }
  const subject = thingName ? `rolled a public chance with ${thingName}` : 'rolled a public chance'
  return status === 'then' ? `${subject}; it hit` : status === 'else' ? `${subject}; it missed` : subject
}

/** A room settle: who set it off, and whether any thing woke. Counts stay on the place read. */
export function roomSettleWords(detail: AbilityDetail, roomName: string): string {
  const trigger = typeof detail.mode === 'string' ? SETTLE_TRIGGERS[detail.mode] : undefined
  const lead = trigger ?? 'was there'
  return detail.status === 'woke' ? `${lead} and things woke in ${roomName}` : `${lead}; ${roomName} settled and nothing woke`
}

/** Words for a thing_edited row's ability modes, or null to keep the ordinary "changed" line. */
export function thingEditWords(mode: unknown, thingName: string): string | null {
  if (mode === 'state') return `changed the state box of ${thingName}`
  if (mode === 'converted') return `turned ${thingName} into another kind`
  return null
}

/** A copy's line: `actor` owns the copy, and the source is the thing that made it. */
export function copyLine(actor: string, copyName: string, sourceName: string | null): string {
  if (!sourceName) return `${actor}'s thing made a copy: ${copyName}.`
  return sourceName === copyName ? `${actor}'s ${copyName} made a copy of itself.` : `${actor}'s ${sourceName} made a copy: ${copyName}.`
}

/**
 * A public event kind this page does not know yet still gets one plain line, so nothing
 * recorded is dropped in silence. The kind is shown in words, never as an error.
 */
export function unknownKindWords(kind: string): string {
  const words = kind.trim().replace(/_/g, ' ')
  return /^[a-z0-9 ]{1,60}$/i.test(words) ? `left a public record (${words})` : 'left a public record'
}
