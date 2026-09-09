import { activityEntry, type ActivityContext, type ActivityEntity, type ActivityPlacementVisibility } from './activity.ts'
import type { ReplayEvent, Resident } from './city/types.ts'
import type { NestedLayout } from './ground/nested.ts'
import { appliedMove } from './replay/index.ts'
import { createPresentResidents, type ResidentState, type Simulation } from './replay/simulation.ts'
import { registrationFor } from './newcomers.ts'
import { createdThing, movedThing } from './things.ts'

export function refreshPresentResidents(
  state: Simulation,
  census: readonly Resident[],
  layout: NestedLayout,
  protectedResidentIds: ReadonlySet<number> = new Set(),
): Readonly<{ state: Simulation; snappedIds: ReadonlySet<number> }> {
  const fresh = createPresentResidents(census, layout, state.reservations)
  const censusById = new Map(census.map(row => [row.id, row]))
  const residents: Record<number, ResidentState> = {}
  const snappedIds = new Set<number>()
  for (const candidate of Object.values(fresh.residents)) {
    const existing = state.residents[candidate.id]
    const censusResident = censusById.get(candidate.id)!
    const protectedResident = existing && protectedResidentIds.has(candidate.id)
    const samePlace = existing && existing.placeId === censusResident.current_place_id
    let next = protectedResident ? withCurrentIdentity(existing, candidate)
      : samePlace && !(!censusResident.asleep && !existing.visible && candidate.visible)
        ? withCurrentIdentity(existing, candidate) : candidate
    if (existing && next === candidate && existing.placeId !== censusResident.current_place_id) snappedIds.add(candidate.id)
    if (censusResident.asleep && (next.bubble !== null || next.visible)) next = Object.freeze({ ...next, bubble: null, visible: false })
    residents[candidate.id] = next
  }
  const pending = Object.values(residents).some(isPending)
  const refreshed = Object.freeze({ ...state, residents: Object.freeze(residents), actors: fresh.actors, pending,
    startedEvents: Object.freeze([]) })
  return Object.freeze({ state: refreshed, snappedIds: Object.freeze(snappedIds) })
}

function withCurrentIdentity(existing: ResidentState, candidate: ResidentState): ResidentState {
  if (existing.handle === candidate.handle && existing.joinedAt === candidate.joinedAt) return existing
  return Object.freeze({ ...existing, handle: candidate.handle, joinedAt: candidate.joinedAt })
}

export function witnessedEvents(
  events: readonly ReplayEvent[], context: ActivityContext, roomId: number,
): readonly ReplayEvent[] {
  const peers = [...events]
  const actorRooms = new Map<string, number>()
  const residents = new Map<string, ActivityEntity>()
  const things = new Map<number, Readonly<{ entity: ActivityEntity; placeId: number }>>()
  const effects = new Map<number, number>()
  const evolving = evolvingActivityContext(context, actorRooms, residents, things, effects)
  const witnessed: ReplayEvent[] = []
  for (const event of events) {
    const move = appliedMove(event)
    const entry = activityEntry(event, evolving, peers)
    let shown = false
    if (move) shown = entry !== null && (move.fromId === roomId || move.toId === roomId)
    else if (entry) {
      shown = event.kind === 'note' || event.kind.startsWith('effect_')
        ? entry.roomId === roomId
        : entry.roomId === roomId || (actorLocatedKind(event.kind) && entry.anchorRoomId === roomId)
    } else shown = rawPublicNoteInRoom(event, evolving, roomId)
    if (shown) witnessed.push(event)
    evolveActivityProof(event, context, actorRooms, residents, things, effects)
  }
  return Object.freeze(witnessed)
}

function evolvingActivityContext(
  base: ActivityContext,
  actorRooms: ReadonlyMap<string, number>,
  residents: ReadonlyMap<string, ActivityEntity>,
  things: ReadonlyMap<number, Readonly<{ entity: ActivityEntity; placeId: number }>>,
  effects: ReadonlyMap<number, number>,
): ActivityContext {
  return Object.freeze({ ...base,
    resident: actor => residents.get(actor.trim()) ?? base.resident(actor),
    residentById: id => [...residents.values()].find(row => row.id === id) ?? base.residentById?.(id) ?? null,
    actorRoom: (actor, time) => actorRooms.has(actor.trim())
      ? publicRoom(actorRooms.get(actor.trim())!, base) : base.actorRoom?.(actor, time) ?? null,
    thing: (id, time) => {
      const found = things.get(id)
      if (found) return publicRoom(found.placeId, base) === null ? null : found
      return base.thing?.(id, time) ?? null
    },
    effect: (id, time) => effects.has(id)
      ? (publicRoom(effects.get(id)!, base) === null ? null : Object.freeze({ placeId: effects.get(id)! }))
      : base.effect?.(id, time) ?? null,
    placementVisibility: (subject, time, before) => {
      const explicit = subject.type === 'actor' ? actorRooms.get(subject.actor.trim())
        : subject.type === 'thing' ? things.get(subject.id)?.placeId : effects.get(subject.id)
      return explicit === undefined ? base.placementVisibility?.(subject, time, before) ?? 'unknown' : roomVisibility(explicit, base)
    },
  })
}

function evolveActivityProof(
  event: ReplayEvent,
  base: ActivityContext,
  actorRooms: Map<string, number>,
  residents: Map<string, ActivityEntity>,
  things: Map<number, Readonly<{ entity: ActivityEntity; placeId: number }>>,
  effects: Map<number, number>,
): void {
  const registration = registrationFor(event)
  if (registration) residents.set(registration.handle, Object.freeze({ type: 'resident', id: registration.id,
    name: registration.handle, hasDrawing: null }))
  const actor = event.actor?.trim()
  const move = event.detail.error == null ? appliedMove(event) : null
  if (actor && move) actorRooms.set(actor, move.toId)
  const created = createdThing(event)
  if (created) {
    const known = base.thing?.(created.id, Date.parse(event.at))?.entity
    const entity = Object.freeze({ type: 'thing' as const, id: created.id,
      name: created.name ?? known?.name ?? `thing #${created.id}`, hasDrawing: known?.hasDrawing ?? null })
    things.set(created.id, Object.freeze({ entity, placeId: created.placeId }))
  }
  const moved = movedThing(event)
  if (moved) {
    const known = things.get(moved.id)?.entity ?? base.thing?.(moved.id, Date.parse(event.at))?.entity
      ?? Object.freeze({ type: 'thing' as const, id: moved.id, name: `thing #${moved.id}`, hasDrawing: null })
    things.set(moved.id, Object.freeze({ entity: known, placeId: moved.placeId }))
  }
  if (event.kind === 'effect_scheduled' && positiveId(event.detail.effect_id) && positiveId(event.detail.place_id)) {
    effects.set(event.detail.effect_id, event.detail.place_id)
  }
}

function roomVisibility(id: number, context: ActivityContext): ActivityPlacementVisibility {
  if (!context.place(id)) return 'unknown'
  return publicRoom(id, context) === null ? 'hidden' : 'public'
}

function publicRoom(id: number, context: ActivityContext): number | null {
  const seen = new Set<number>()
  let place = context.place(id)
  while (place) {
    if (place.quiet || seen.has(place.id)) return null
    seen.add(place.id)
    if (place.parentId === null) return id
    place = context.place(place.parentId)
  }
  return null
}

const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const actorLocatedKind = (kind: string): boolean => kind === 'action' || kind === 'resident_edited' || kind.startsWith('thing_')

function rawPublicNoteInRoom(event: ReplayEvent, context: ActivityContext, roomId: number): boolean {
  if (event.kind !== 'note' || event.detail.place_id !== roomId || !Number.isSafeInteger(event.detail.note_id)
    || Number(event.detail.note_id) <= 0 || !event.actor?.trim() || !context.resident(event.actor)) return false
  const time = Date.parse(event.at)
  if (!Number.isFinite(time) || !/^\d+$/.test(event.change_id) || !context.roomName(roomId, time)?.trim()) return false
  const seen = new Set<number>()
  let place = context.place(roomId)
  while (place) {
    if (place.quiet || seen.has(place.id)) return false
    seen.add(place.id)
    if (place.parentId === null) return true
    place = context.place(place.parentId)
  }
  return false
}

function isPending(resident: ResidentState): boolean {
  return resident.walking || resident.bubble !== null || resident.sparkle !== null || resident.showingNotice != null
    || resident.blockedAttempt != null || resident.transferUntil !== null || resident.inventionUntil != null
    || resident.agreementUntil != null || resident.queue.length > 0
}
