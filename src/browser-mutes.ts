// The human mute list (city step 2, decision C): what one browser asked not to see.
// The city's window owns the controls and writes the list under one storage key on the
// 1f3d9.com origin; the live view at 1f3d9.com/live/ shares that origin, so it reads the
// same list. This page only reads it and never writes it. Nothing here reaches the city.
//
// The parser and the rule are copied on purpose into the window (a separate repo and
// build). One shared data file, test/fixtures/browser-mutes-fixture.json, pins both
// copies; change the rule only together with that file and the window's copy.
//
// The rule matches the residents' own rule (the city's src/reader-mutes.ts):
// - Never hidden: both founder accounts, residents #1 and #2 (the owner, 2026-10-18:
//   "Both founders."), any note, line, thing or event either founder writes, makes or
//   owns, and a place either founder owns. A mute on a founder-owned place still hides
//   other residents and their items inside it, and both founders stay.
// - An item allow (a note or a thing) beats every mute; an item mute comes next.
// - Then a mute on the author or maker, then a mute on the kind.
// - Then places: the nearest place choice at or above the item's place wins, so an allow
//   on a place beats a mute on a place above it, and muting a place mutes everything
//   inside it.
// - A resident or a kind cannot be allowed; such an entry is kept but changes nothing.
// Two differences from the residents' rule, on purpose or for want of data: a resident
// standing in a muted place is hidden here (decision C: muting a place mutes everything
// inside it), and a place owned by a muted resident is not hidden here, because the
// page's place list does not say who owns most places.

export const BROWSER_MUTES_KEY = '1f3d9:mutes:v1'
export const BROWSER_MUTES_VERSION = 1
export const BROWSER_MUTES_MAX_ITEMS = 1000
/** Both founder accounts, residents #1 and #2: never muted, never hidden. */
export const FOUNDER_RESIDENT_IDS: readonly number[] = Object.freeze([1, 2])
/** Whether a resident number names one of the founder accounts. */
export function isFounder(id: number | null | undefined): boolean {
  return typeof id === 'number' && FOUNDER_RESIDENT_IDS.includes(id)
}
const MAX_TARGET_ID = 2_147_483_647

export const MUTE_TYPES = Object.freeze(['resident', 'place', 'note', 'thing', 'kind'] as const)
export type MuteType = typeof MUTE_TYPES[number]
export const MUTE_CHOICES = Object.freeze(['mute', 'allow'] as const)
export type MuteChoice = typeof MUTE_CHOICES[number]
export type BrowserMute = Readonly<{ type: MuteType; id: number; choice: MuteChoice }>

const NONE: readonly BrowserMute[] = Object.freeze([])

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function entry(value: unknown): BrowserMute | null {
  if (!plainObject(value)) return null
  const { type, id, choice } = value
  if (typeof type !== 'string' || !(MUTE_TYPES as readonly string[]).includes(type)) return null
  if (typeof choice !== 'string' || !(MUTE_CHOICES as readonly string[]).includes(choice)) return null
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > MAX_TARGET_ID) return null
  return Object.freeze({ type: type as MuteType, id, choice: choice as MuteChoice })
}

/**
 * The stored list, or an empty list when the value is absent, not JSON, not version 1,
 * longer than the cap, or holds any entry that is not {type, id, choice}. Other keys are
 * ignored. A later entry for the same type and id replaces an earlier one. An entry
 * naming either founder is dropped: neither founder can be muted.
 */
export function parseBrowserMutes(raw: string | null | undefined): readonly BrowserMute[] {
  if (typeof raw !== 'string') return NONE
  let value: unknown
  try { value = JSON.parse(raw) } catch { return NONE }
  if (!plainObject(value) || value['version'] !== BROWSER_MUTES_VERSION || !Array.isArray(value['items'])) return NONE
  const items = value['items'] as unknown[]
  if (items.length > BROWSER_MUTES_MAX_ITEMS) return NONE
  const kept = new Map<string, BrowserMute>()
  for (const item of items) {
    const parsed = entry(item)
    if (!parsed) return NONE
    const key = `${parsed.type}:${String(parsed.id)}`
    kept.delete(key)
    if (!(parsed.type === 'resident' && isFounder(parsed.id))) kept.set(key, parsed)
  }
  return kept.size ? Object.freeze([...kept.values()]) : NONE
}

type StorageReader = Pick<Storage, 'getItem'>

/** This browser's list. Storage that is missing, blocked or throwing gives an empty list. */
export function readBrowserMutes(storage: () => StorageReader | undefined = () => globalThis.localStorage): readonly BrowserMute[] {
  try {
    const store = storage()
    return store ? parseBrowserMutes(store.getItem(BROWSER_MUTES_KEY)) : NONE
  } catch {
    return NONE
  }
}

type Choices = Readonly<{ muted: ReadonlySet<number>; allowed: ReadonlySet<number> }>

/** One list compiled once, so each question below is a few set lookups. */
export type MuteRules = Readonly<{
  empty: boolean
  residents: ReadonlySet<number>
  kinds: ReadonlySet<number>
  notes: Choices
  things: Choices
  places: ReadonlyMap<number, MuteChoice>
}>

export function compileMutes(list: readonly BrowserMute[]): MuteRules {
  const residents = new Set<number>(); const kinds = new Set<number>()
  const notes = { muted: new Set<number>(), allowed: new Set<number>() }
  const things = { muted: new Set<number>(), allowed: new Set<number>() }
  const places = new Map<number, MuteChoice>()
  for (const { type, id, choice } of list) {
    if (type === 'resident') { if (choice === 'mute' && !isFounder(id)) residents.add(id) }
    else if (type === 'kind') { if (choice === 'mute') kinds.add(id) }
    else if (type === 'note') (choice === 'mute' ? notes.muted : notes.allowed).add(id)
    else if (type === 'thing') (choice === 'mute' ? things.muted : things.allowed).add(id)
    else places.set(id, choice)
  }
  return Object.freeze({ empty: list.length === 0, residents, kinds,
    notes: Object.freeze(notes), things: Object.freeze(things), places })
}

export type MutePlace = Readonly<{ id: number; parent_id: number | null }>

/**
 * Every place the list hides: the nearest place choice at or above each place wins. A
 * muted place missing from the page's place list still hides what names it directly.
 */
export function hiddenPlaces(rules: MuteRules, places: readonly MutePlace[]): ReadonlySet<number> {
  const hidden = new Set<number>()
  if (rules.places.size === 0) return hidden
  const byId = new Map(places.map(place => [place.id, place]))
  for (const place of places) if (nearestPlaceChoice(rules, byId, place.id)?.choice === 'mute') hidden.add(place.id)
  for (const [id, choice] of rules.places) if (choice === 'mute' && !byId.has(id)) hidden.add(id)
  return hidden
}

/** The nearest place choice at or above one place, and the place that carries it. */
export function nearestPlaceChoice(rules: MuteRules, byId: ReadonlyMap<number, MutePlace>, placeId: number):
  Readonly<{ placeId: number; choice: MuteChoice }> | null {
  const seen = new Set<number>()
  let current = byId.get(placeId)
  while (current && !seen.has(current.id)) {
    const choice = rules.places.get(current.id)
    if (choice) return Object.freeze({ placeId: current.id, choice })
    seen.add(current.id)
    current = current.parent_id === null ? undefined : byId.get(current.parent_id)
  }
  return null
}

/**
 * Something the page may show. A place carries its owner where the page knows it; a
 * resident or a listening mark names the resident and where it stands; a note,
 * line or thing carries its author or maker, owner, kind and place where the page knows
 * them; an event (a log line) carries its actor and the note, thing, kind and place it
 * names. A missing fact never hides anything.
 */
export type MuteSubject = Readonly<{
  type: 'resident' | 'mark' | 'place' | 'note' | 'line' | 'thing' | 'event'
  id?: number | null
  author_id?: number | null
  owner_id?: number | null
  kind_id?: number | null
  place_id?: number | null
  note_id?: number | null
  thing_id?: number | null
}>

const known = (value: number | null | undefined): value is number => typeof value === 'number'

/** Whether this browser's list hides the subject. `places` is hiddenPlaces() for the list. */
export function hiddenByMutes(subject: MuteSubject, rules: MuteRules, places: ReadonlySet<number>): boolean {
  if (rules.empty) return false
  const inHiddenPlace = known(subject.place_id) && places.has(subject.place_id)
  if (subject.type === 'place') return !isFounder(subject.owner_id) && known(subject.id) && places.has(subject.id)
  if (subject.type === 'resident' || subject.type === 'mark') {
    if (isFounder(subject.id)) return false
    return (known(subject.id) && rules.residents.has(subject.id)) || inHiddenPlace
  }
  if (isFounder(subject.author_id) || isFounder(subject.owner_id)) return false
  const noteId = subject.type === 'note' ? subject.id : subject.type === 'event' ? subject.note_id : null
  const thingId = subject.type === 'thing' ? subject.id : subject.type === 'event' ? subject.thing_id : null
  if ((known(noteId) && rules.notes.allowed.has(noteId)) || (known(thingId) && rules.things.allowed.has(thingId))) return false
  if ((known(noteId) && rules.notes.muted.has(noteId)) || (known(thingId) && rules.things.muted.has(thingId))) return true
  if (known(subject.author_id) && rules.residents.has(subject.author_id)) return true
  if (known(subject.kind_id) && rules.kinds.has(subject.kind_id)) return true
  return inHiddenPlace
}
