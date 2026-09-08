import type { ActivityContext, ActivityEntity } from './activity.ts'
import type { ReplayEvent, ReplayFile, Resident } from './city/types.ts'
import { appliedMove } from './replay/index.ts'

type TimedValue<T> = Readonly<{ at: number; value: T }>
const validId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const eventTime = (event: ReplayEvent): number => Date.parse(event.at)
const latest = <T>(rows: readonly TimedValue<T>[], time: number): T | null => {
  let found: T | null = null; for (const row of rows) { if (row.at > time) break; found = row.value } return found
}

/** Adds time-aware public-record lookups without consulting current census positions for past events. */
export function createHistoricalActivityContext(replay: ReplayFile, census: readonly Resident[], base: ActivityContext): ActivityContext {
  const byHandle = new Map(census.flatMap(row => row.handle?.trim() ? [[row.handle.trim(), Object.freeze({ type: 'resident' as const,
    id: row.id, name: row.handle.trim(), hasDrawing: row.has_drawing })]] : []))
  const byResidentId = new Map([...byHandle.values()].map(row => [row.id, row]))
  const rooms = new Map<string, TimedValue<number>[]>()
  const things = new Map<number, TimedValue<Readonly<{ entity: ActivityEntity; placeId: number | null }>>[]>()
  const effects = new Map<number, TimedValue<Readonly<{ placeId: number | null; thingId: number | null }>>[]>()
  const beginning = Date.parse(replay.window_start)
  const rootId = replay.map.places.find(place => place.parent_id === null)?.id ?? null
  const publicRoom = (id: number | null): number | null => {
    if (id === null) return null
    const seen = new Set<number>(); let place = base.place(id)
    while (place) { if (place.quiet || seen.has(place.id)) return null; seen.add(place.id); place = place.parentId === null ? null : base.place(place.parentId) }
    return id
  }
  for (const [key, start] of Object.entries(replay.start)) {
    if (!start || !validId(start.place_id)) continue
    const match = /^thing:(\d+)$/.exec(key)
    if (match) {
      const id = Number(match[1]); const entity = Object.freeze({ type: 'thing' as const, id, name: `thing #${id}`, hasDrawing: null })
      things.set(id, [{ at: beginning, value: Object.freeze({ entity, placeId: start.place_id }) }])
    } else {
      const residentMatch = /^resident:(\d+)$/.exec(key)
      const handle = residentMatch ? byResidentId.get(Number(residentMatch[1]))?.name : key
      if (handle) rooms.set(handle, [{ at: beginning, value: start.place_id }])
    }
  }
  for (const event of [...replay.timeline].sort((a, b) => eventTime(a) - eventTime(b))) {
    const time = eventTime(event); if (!Number.isFinite(time)) continue
    const actor = event.actor?.trim(); const move = event.detail.error == null ? appliedMove(event) : null
    const noteRoom = event.kind === 'note' && validId(event.detail.place_id) ? event.detail.place_id : null
    const registerRoom = event.kind === 'register' && validId(event.detail.resident_id) ? rootId : null
    const actorDestination = move?.toId ?? noteRoom ?? registerRoom
    if (actor && actorDestination !== null) { const history = rooms.get(actor) ?? []; history.push({ at: time, value: actorDestination }); rooms.set(actor, history) }
    const detail = event.detail
    const thingId = validId(detail.thing_id) ? detail.thing_id : validId(detail.source_thing_id) ? detail.source_thing_id : null
    if (thingId !== null && ['thing_created', 'thing_moved'].includes(event.kind) && validId(detail.place_id)) {
      const history = things.get(thingId) ?? []; const prior = latest(history, time)
      const name = typeof detail.name === 'string' && detail.name.trim() ? detail.name.trim() : prior?.entity.name ?? `thing #${thingId}`
      const entity = Object.freeze({ type: 'thing' as const, id: thingId, name, hasDrawing: prior?.entity.hasDrawing ?? null })
      history.push({ at: time, value: Object.freeze({ entity, placeId: detail.place_id }) }); things.set(thingId, history)
    }
    if (thingId !== null && event.kind === 'thing_withdrawn') {
      const history = things.get(thingId) ?? []; const prior = latest(history, time)
      const entity = prior?.entity ?? Object.freeze({ type: 'thing' as const, id: thingId, name: `thing #${thingId}`, hasDrawing: null })
      history.push({ at: time, value: Object.freeze({ entity, placeId: null }) }); things.set(thingId, history)
    }
    if (event.kind === 'effect_scheduled' && validId(detail.effect_id)) {
      const history = effects.get(detail.effect_id) ?? []; history.push({ at: time,
        value: Object.freeze({ placeId: validId(detail.place_id) ? detail.place_id : null, thingId }) }); effects.set(detail.effect_id, history)
    }
  }
  return Object.freeze({ ...base,
    resident: actor => byHandle.get(actor.trim()) ?? base.resident(actor),
    residentById: id => byResidentId.get(id) ?? base.residentById?.(id) ?? null,
    actorRoom: (actor, time) => publicRoom(latest(rooms.get(actor.trim()) ?? [], time)),
    thing: (id, time) => { const found = latest(things.get(id) ?? [], time); return found && publicRoom(found.placeId) !== null ? found : null },
    effect: (id, time) => { const found = latest(effects.get(id) ?? [], time); return found && publicRoom(found.placeId) !== null ? found : null } })
}
