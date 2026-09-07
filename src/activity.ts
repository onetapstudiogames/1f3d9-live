import type { ReplayEvent, ReplayPlace, Resident } from './city/types.ts'
import { appliedMove } from './replay/index.ts'

export type ActivityEntityType = 'resident' | 'place' | 'thing'
export type ActivityEntity = Readonly<{ type: ActivityEntityType; id: number; name: string; hasDrawing: boolean | null }>
export type ActivityEntry = Readonly<{ key: string; changeId: number; time: number; kind: 'chat' | 'move' | 'thing-made';
  text: string; entities: readonly ActivityEntity[] }>
export type ActivityPlace = Readonly<{ id: number; name: string; parentId: number | null; quiet: boolean; hasDrawing: boolean }>
export type ActivityContext = Readonly<{
  resident(actor: string): ActivityEntity | null
  place(id: number): ActivityPlace | null
  roomName(id: number, time: number): string | null
}>
export type ActivityState = Readonly<{ entries: readonly ActivityEntry[]; highWater: number }>
export type ActivityFilter = 'all' | 'chats'

const validId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const changeId = (value: string): number | null => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null

export function emptyActivity(): ActivityState {
  return Object.freeze({ entries: Object.freeze([]), highWater: 0 })
}

export function createActivityContext(census: readonly Resident[], places: readonly ReplayPlace[],
  roomName: (place: ReplayPlace, time: number) => string | null): ActivityContext {
  const residents = new Map(census.flatMap(row => row.handle?.trim()
    ? [[row.handle.trim(), Object.freeze({ type: 'resident' as const, id: row.id, name: row.handle.trim(), hasDrawing: row.has_drawing })]] : []))
  const byId = new Map(places.map(place => [place.id, place]))
  return Object.freeze({
    resident: (actor: string) => residents.get(actor.trim()) ?? null,
    place: (id: number) => {
      const place = byId.get(id)
      return place ? Object.freeze({ id, name: place.name, parentId: place.parent_id, quiet: place.quiet, hasDrawing: place.has_drawing }) : null
    },
    roomName: (id: number, time: number) => { const place = byId.get(id); return place ? roomName(place, time) : null },
  })
}

function visiblePlace(id: number, context: ActivityContext): ActivityPlace | null {
  const seen = new Set<number>()
  let place = context.place(id)
  const initial = place
  while (place) {
    if (place.quiet || seen.has(place.id)) return null
    seen.add(place.id)
    if (place.parentId === null) return initial
    place = context.place(place.parentId)
  }
  return null
}

function placeEntity(id: number, time: number, context: ActivityContext): ActivityEntity | null {
  const place = visiblePlace(id, context); const name = context.roomName(id, time)?.trim()
  return place && name ? Object.freeze({ type: 'place', id, name, hasDrawing: place.hasDrawing }) : null
}

export function activityEntry(event: ReplayEvent, context: ActivityContext): ActivityEntry | null {
  const id = changeId(event.change_id); const time = Date.parse(event.at)
  const actorName = event.actor?.trim(); const resident = actorName ? context.resident(actorName) : null
  if (id === null || !Number.isFinite(time) || !resident || resident.type !== 'resident') return null
  const actor: ActivityEntity = Object.freeze({ ...resident, name: actorName! })
  if (event.kind === 'note' && validId(event.detail.note_id) && validId(event.detail.place_id)) {
    const place = placeEntity(event.detail.place_id, time, context)
    if (!place) return null
    const line = typeof event.line === 'string' ? event.line : ''
    const text = line.length ? `${actor.name} in ${place.name}: ${line}` : `${actor.name} posted a note in ${place.name}.`
    return Object.freeze({ key: event.change_id, changeId: id, time, kind: 'chat', text,
      entities: Object.freeze([actor, place]) })
  }
  const move = appliedMove(event)
  if (move) {
    const from = placeEntity(move.fromId, time, context); const to = placeEntity(move.toId, time, context)
    if (!from || !to) return null
    return Object.freeze({ key: event.change_id, changeId: id, time, kind: 'move',
      text: `${actor.name} moved from ${from.name} to ${to.name}.`, entities: Object.freeze([actor, from, to]) })
  }
  const detail = event.detail; const name = typeof detail.name === 'string' ? detail.name.trim() : ''
  if (event.kind === 'thing_created' && validId(detail.thing_id) && validId(detail.place_id) && name) {
    const place = placeEntity(detail.place_id, time, context)
    if (!place) return null
    const thing: ActivityEntity = Object.freeze({ type: 'thing', id: detail.thing_id, name, hasDrawing: null })
    return Object.freeze({ key: event.change_id, changeId: id, time, kind: 'thing-made',
      text: `${actor.name} made ${name} in ${place.name}.`, entities: Object.freeze([actor, place, thing]) })
  }
  return null
}

export function activityReduce(state: ActivityState, rows: readonly ReplayEvent[], recordedNow: number,
  context: ActivityContext, limit = 100): ActivityState {
  if (!Number.isFinite(recordedNow) || !Number.isSafeInteger(limit) || limit < 1) return state
  const due = rows.flatMap(event => {
    const id = changeId(event.change_id); const time = Date.parse(event.at)
    return id !== null && id > state.highWater && Number.isFinite(time) && time <= recordedNow ? [{ event, id }] : []
  }).sort((a, b) => a.id - b.id)
  const ordered = [...new Map(due.map(row => [row.id, row])).values()]
  if (!ordered.length) return state
  const appended = ordered.flatMap(({ event }) => activityEntry(event, context) ?? [])
  const entries = [...state.entries, ...appended].slice(-limit)
  return Object.freeze({ entries: Object.freeze(entries), highWater: ordered.at(-1)!.id })
}

export function activityVisible(entries: readonly ActivityEntry[], filter: ActivityFilter): readonly ActivityEntry[] {
  return filter === 'chats' ? Object.freeze(entries.filter(entry => entry.kind === 'chat')) : entries
}
