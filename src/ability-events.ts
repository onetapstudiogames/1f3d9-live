// The feed may carry null in any field, so every detail is read as unknown.
type AbilityDetail = Readonly<Record<string, unknown>>

// Room-log words for the city's ability records (city decisions #104 to #115, city PRs
// #359, #360, and #368). Since city PR #368 the change feed also carries the numbers: a
// roll's roll, sides, percent, purpose, and outcome; a settle's tried, woke, and forfeited;
// a state write's key, op, and version; a copy's generation; a conversion's from_kind_id and
// law_trait_id; and two kinds of their own, copy_skipped and room_reached. Each number is
// shown only when the row carries it in the expected shape, so an older row, or a row the
// city trimmed, reads exactly as it did before and nothing is ever guessed.

const SETTLE_TRIGGERS: Readonly<Record<string, string>> = Object.freeze({
  arrive: 'arrived', talk: 'spoke', act: 'acted', me: 'checked in',
})

const WRITE_OPS: Readonly<Record<string, string>> = Object.freeze({
  set: 'set', add: 'added to', append: 'appended to',
})

const GROWTH_CAPS: Readonly<Record<string, string>> = Object.freeze({
  generations: 'generation limit', copies: 'copy limit', no_arrivals: 'no-arrivals rule',
  place_daily: 'room daily limit', family_share: 'family share limit',
})

// A state key is a lower-case world name on the city (physics WORLD_NAME_RE).
const STATE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** A whole number the row really carries, or null. Zero counts. */
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function positive(value: unknown): number | null {
  const n = count(value)
  return n !== null && n > 0 ? n : null
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Why a recorded roll did not count, or '' when it counted or the row does not say. */
function rollOutcome(outcome: unknown): string {
  if (outcome === 'action_failed') return '; the action failed, so it did not count'
  if (outcome === 'member_refused') return '; the thing it reached refused, so it did not count'
  return ''
}

/** A chance roll: `then` ran on a hit, `else` on a miss, and a pick has no branch. */
export function chanceRollWords(detail: AbilityDetail, thingName: string, roomName: string | null): string {
  const status = detail.status
  const roll = count(detail.roll); const sides = positive(detail.sides)
  const numbers = roll !== null && sides !== null ? `${roll} of ${sides}` : null
  const tail = rollOutcome(detail.outcome)
  const wakePick = detail.purpose === 'wake_pick' || (detail.purpose === undefined && status === null && !thingName)
  if (wakePick) {
    const where = roomName ? ` in ${roomName}` : ''
    return numbers ? `rolled ${numbers} to pick which things wake${where}${tail}` : `set off a public roll that picked which things wake${where}${tail}`
  }
  if (detail.purpose === 'copy_place') {
    const whose = thingName ? ` a copy of ${thingName}` : ' a copy'
    return `${numbers ? `rolled ${numbers}` : 'rolled a public chance'} to pick where${whose} lands${tail}`
  }
  const percent = count(detail.percent)
  const chance = percent !== null && percent <= 100 ? `, a ${percent} percent chance` : ''
  const subject = numbers
    ? `rolled ${numbers}${thingName ? ` with ${thingName}` : ''}${chance}`
    : thingName ? `rolled a public chance with ${thingName}` : 'rolled a public chance'
  const branch = status === 'then' ? (numbers ? ', hit' : '; it hit') : status === 'else' ? (numbers ? ', missed' : '; it missed') : ''
  return `${subject}${branch}${tail}`
}

/** A room settle: who set it off, whether any thing woke, and the counts when carried. */
export function roomSettleWords(detail: AbilityDetail, roomName: string): string {
  const trigger = typeof detail.mode === 'string' ? SETTLE_TRIGGERS[detail.mode] : undefined
  const lead = trigger ?? 'was there'
  const base = detail.status === 'woke' ? `${lead} and things woke in ${roomName}` : `${lead}; ${roomName} settled and nothing woke`
  const tried = count(detail.tried); const woke = count(detail.woke); const forfeited = count(detail.forfeited)
  if (tried === null || woke === null) return base
  return `${base}: ${tried} tried, ${woke} woke${forfeited ? `, ${forfeited} dropped` : ''}`
}

/** Words for a thing_edited row's ability modes, or null to keep the ordinary "changed" line. */
export function thingEditWords(detail: AbilityDetail, thingName: string): string | null {
  if (detail.mode === 'state') return stateWriteWords(detail, thingName)
  if (detail.mode === 'converted') return conversionWords(detail, thingName)
  return null
}

function stateWriteWords(row: AbilityDetail, thingName: string): string {
  const version = positive(row.version)
  const at = version === null ? '' : `, version ${version}`
  const key = typeof row.key === 'string' && STATE_KEY.test(row.key) ? row.key : null
  const op = typeof row.op === 'string' ? row.op : null
  if (op === 'clear') return `cleared the state box of ${thingName}${at}`
  const verb = op ? WRITE_OPS[op] : undefined
  if (verb && key) return `${verb} ${key} in the state box of ${thingName}${at}`
  if (key) return `wrote ${key} in the state box of ${thingName}${at}`
  return `changed the state box of ${thingName}${at}`
}

function conversionWords(row: AbilityDetail, thingName: string): string {
  const to = positive(row.kind_id); const from = positive(row.from_kind_id)
  const byLaw = positive(row.law_trait_id) !== null ? ' by a law' : ''
  if (to === null) return `turned ${thingName} into another kind${byLaw}`
  return `turned ${thingName}${from !== null ? ` from kind #${from}` : ''} into kind #${to}${byLaw}`
}

/** A copy's line: `actor` owns the copy, and the source is the thing that made it. */
export function copyLine(actor: string, copyName: string, sourceName: string | null, generation?: unknown): string {
  const gen = positive(generation)
  const suffix = gen === null ? '' : `, generation ${gen}`
  if (!sourceName) return `${actor}'s thing made a copy: ${copyName}${suffix}.`
  return sourceName === copyName ? `${actor}'s ${copyName} copied itself${suffix}.` : `${actor}'s ${sourceName} made a copy: ${copyName}${suffix}.`
}

/** A copy a growth limit stopped. The actor is the copying thing's owner. */
export function copySkippedWords(detail: AbilityDetail, thingName: string): string {
  const of = thingName ? ` of ${thingName}` : ''
  const cap = typeof detail.cap === 'string' ? GROWTH_CAPS[detail.cap] : undefined
  if (!cap) return `had a copy${of} stopped by a growth limit`
  const limit = count(detail.limit); const over = positive(detail.over_by)
  return `had a copy${of} refused: ${cap}${limit !== null ? ` ${limit}` : ''}${over !== null ? `, over by ${over}` : ''}`
}

/** A reach across a room. It never names a resident it reached, only how many. */
export function roomReachedWords(detail: AbilityDetail, thingName: string, roomName: string): string {
  const from = thingName ? ` from ${thingName}` : detail.thing_id === null ? " from the room's law" : ''
  const lead = `set off a reach${from} in ${roomName}`
  const reached = count(detail.reached)
  const over = detail.over === 'residents' ? ['resident', 'residents'] : detail.over === 'things' ? ['thing', 'things'] : null
  if (reached === null || !over) return lead
  const parts = [`reached ${plural(reached, over[0]!, over[1]!)}`]
  const refused = positive(detail.skipped); if (refused !== null) parts.push(`${refused} refused`)
  const more = positive(detail.more); if (more !== null) parts.push(`${more} more left out`)
  const stopped = detail.stopped === 'action_reach_limit' ? "; the action's reach limit stopped it" : ''
  return `${lead}: ${parts.join(', ')}${stopped}`
}

/**
 * A public event kind this page does not know yet still gets one plain line, so nothing
 * recorded is dropped in silence. The kind is shown in words, never as an error.
 */
export function unknownKindWords(kind: string): string {
  const words = kind.trim().replace(/_/g, ' ')
  return /^[a-z0-9 ]{1,60}$/i.test(words) ? `left a public record (${words})` : 'left a public record'
}
