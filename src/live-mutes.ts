import { compileMutes, hiddenByMutes, hiddenPlaces, type BrowserMute, type MutePlace, type MuteRules,
  type MuteSubject } from './browser-mutes.ts'
import type { ReplayEvent, ThingIds } from './city/types.ts'

const NO_PLACES: ReadonlySet<number> = new Set()
const positive = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null

/** A change-feed row as the mute rule sees it: its actor and the note, thing, kind and place it names. */
export function eventSubject(event: ReplayEvent, actorId: number | null): MuteSubject {
  const detail = event.detail
  return Object.freeze({ type: 'event', author_id: actorId, note_id: positive(detail.note_id),
    thing_id: positive(detail.thing_id) ?? positive(detail.source_thing_id), kind_id: positive(detail['kind_id']),
    place_id: positive(detail.place_id) })
}

/** A thing on the floor as the mute rule sees it, with whatever numbered facts the page has read. */
export function thingSubject(thing: Readonly<{ id: number; placeId: number }>, ids: ThingIds | undefined): MuteSubject {
  return Object.freeze({ type: 'thing', id: thing.id, author_id: ids?.makerId ?? null, owner_id: ids?.ownerId ?? null,
    kind_id: ids?.kindId ?? null, place_id: thing.placeId })
}

/**
 * The browser's mute list as the scene uses it: the list in force, the places it hides
 * (worked out once per place directory), and one question per kind of thing on screen.
 */
export class LiveMutes {
  private list: readonly BrowserMute[] = []
  private compiled: MuteRules = compileMutes([])
  private placesSeen: readonly MutePlace[] | null = null
  private placesHidden: ReadonlySet<number> = NO_PLACES

  constructor(list: readonly BrowserMute[] = []) { this.replace(list) }

  /** Takes a newly read list; true when it differs from the list in force. */
  replace(list: readonly BrowserMute[]): boolean {
    if (JSON.stringify(list) === JSON.stringify(this.list)) return false
    this.list = list; this.compiled = compileMutes(list)
    this.placesSeen = null; this.placesHidden = NO_PLACES
    return true
  }

  get empty(): boolean { return this.compiled.empty }
  get rules(): MuteRules { return this.compiled }

  /** Places the list hides, with every place inside them, for one place directory. */
  rooms(places: readonly MutePlace[]): ReadonlySet<number> {
    if (this.compiled.places.size === 0) return NO_PLACES
    if (this.placesSeen !== places) { this.placesSeen = places; this.placesHidden = hiddenPlaces(this.compiled, places) }
    return this.placesHidden
  }

  /** Residents the list hides wherever they stand. The founder is never among them. */
  residents(): ReadonlySet<number> { return this.compiled.residents }

  thingHidden(thing: Readonly<{ id: number; placeId: number }>, ids: ThingIds | undefined, places: readonly MutePlace[]): boolean {
    return !this.empty && hiddenByMutes(thingSubject(thing, ids), this.compiled, this.rooms(places))
  }

  eventHidden(event: ReplayEvent, actorId: number | null, places: readonly MutePlace[]): boolean {
    return !this.empty && hiddenByMutes(eventSubject(event, actorId), this.compiled, this.rooms(places))
  }

  lineHidden(line: Readonly<{ id: number; placeId: number }>, authorId: number | null, places: readonly MutePlace[]): boolean {
    return !this.empty && hiddenByMutes({ type: 'line', id: line.id, author_id: authorId, place_id: line.placeId },
      this.compiled, this.rooms(places))
  }
}
