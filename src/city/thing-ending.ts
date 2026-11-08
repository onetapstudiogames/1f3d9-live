// Thing endings (city decisions #171 to #180, city PR #489). The thing read carries the
// full `ending` object and `end_program_summary`; every row that names a thing, the room
// outline's thing rows included, carries the short status `ends` only when an end is set
// or came. Both are read tolerantly: anything unreadable reads as no ending, never a guess.
// Source of truth: docs/CITY-API.md "Thing endings".

export type ShortEnds = Readonly<{ state: 'set' | 'ended'; at: string | null }>

export type ThingEndingStatus = 'not_permitted_by_kind' | 'permitted_but_unset' | 'active' | 'due_waiting_settle' | 'ended'

export type ThingEnding = Readonly<{
  status: ThingEndingStatus
  /** Each condition as the read computed it (ends_at, uses_left, unused_deadline). */
  conditions: readonly Readonly<Record<string, unknown>>[]
  soonestKnownEnd: string | null
  endedAt: string | null
}>

const STATUSES: ReadonlySet<string> = new Set(['not_permitted_by_kind', 'permitted_but_unset', 'active', 'due_waiting_settle', 'ended'])
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An ISO time the city wrote, or null. */
export function endingTime(value: unknown): string | null {
  return typeof value === 'string' && ISO_TIME.test(value) && Number.isFinite(Date.parse(value)) ? value : null
}

/** The short status `ends` of one row, or null when the row carries none or an unreadable one. */
export function parseShortEnds(value: unknown): ShortEnds | null {
  if (!isRecord(value) || (value['state'] !== 'set' && value['state'] !== 'ended')) return null
  const at = value['at'] === null ? null : endingTime(value['at'])
  if (value['at'] !== null && at === null) return null
  return Object.freeze({ state: value['state'], at })
}

/** The full ending object of a thing read, or null when it is missing or cannot be read. */
export function parseThingEnding(value: unknown): ThingEnding | null {
  if (!isRecord(value) || typeof value['status'] !== 'string' || !STATUSES.has(value['status'])) return null
  const conditions = Array.isArray(value['conditions'])
    ? value['conditions'].filter(isRecord).map(condition => Object.freeze({ ...condition })) : []
  return Object.freeze({
    status: value['status'] as ThingEndingStatus,
    conditions: Object.freeze(conditions),
    soonestKnownEnd: endingTime(value['soonest_known_end']),
    endedAt: endingTime(value['ended_at']),
  })
}

/** A thing whose own row says its end came: a remnant (due ends read ended too). */
export function thingIsRemnant(ends: ShortEnds | null | undefined): boolean {
  return ends?.state === 'ended'
}

/** One string per short status, so a changed status can be told from an unchanged one. */
export function shortEndsKey(ends: ShortEnds | null | undefined): string {
  return ends ? `${ends.state}:${ends.at ?? ''}` : 'none'
}
