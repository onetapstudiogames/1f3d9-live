import type { PlaceOutline, ReplayEvent, ReplayFile } from './city/types.ts'
import type { NestedLayout } from './ground/nested.ts'
import { stageFindFreeSpots, type StageStandingEntry, type StageStandingSpot } from './ground/stage-ground.ts'

export type ThingEffectKind = 'puff' | 'glow' | 'crumbs'
export type ThingEffect = Readonly<{ kind: ThingEffectKind; startedAt: number; expiresAt: number }>
export type ThingState = Readonly<{
  id: number
  name: string | null
  placeId: number
  x: number
  y: number
  visible: boolean
  effect: ThingEffect | null
}>
export type ThingSpot = Readonly<{ id: number; placeId: number; x: number; y: number }>
export type ThingReservations = Readonly<Record<number, readonly StageStandingSpot[]>>
export type ThingPlan = Readonly<{
  reservations: ThingReservations
  issues: readonly string[]
}>
export type ThingSimulation = Readonly<{
  things: Readonly<Record<number, ThingState>>
  reservations: ThingReservations
  issues: readonly string[]
  queue: readonly ReplayEvent[]
  pending: boolean
}>
export type EffectFrame = Readonly<{ progress: number; puff: boolean; glow: boolean; crumbs: boolean }>
export type CreatedThing = Readonly<{ id: number; placeId: number; name: string | null }>
export type MovedThing = Readonly<{ id: number; placeId: number }>

const EFFECT_MS: Readonly<Record<ThingEffectKind, number>> = { puff: 1_800, glow: 1_600, crumbs: 1_400 }
const OVERFLOW_ISSUE = 'Some things did not fit on the floor, so they are not shown.'

export function planThingSpots(replay: ReplayFile, layout: NestedLayout): ThingPlan {
  const candidates = new Map<string, Readonly<{ id: number; placeId: number }>>()
  const addCandidate = (id: number, placeId: number): void => {
    if (placeVisible(layout, placeId)) candidates.set(`${String(placeId)}:${String(id)}`, { id, placeId })
  }
  for (const [key, start] of Object.entries(replay.start)) {
    const match = /^thing:(\d+)$/.exec(key)
    const id = match ? Number(match[1]) : 0
    if (validId(id) && start && validId(start.place_id)) addCandidate(id, start.place_id)
  }
  for (const row of replay.timeline) {
    const placement = createdThing(row) ?? movedThing(row)
    if (placement) addCandidate(placement.id, placement.placeId)
  }

  const touched = touchedThingIds(replay.timeline)
  const reservations: Record<number, readonly StageStandingSpot[]> = {}
  let overflow = false
  for (const placeId of [...new Set([...candidates.values()].map(item => item.placeId))].sort((a, b) => a - b)) {
    const room = layout.rooms[placeId]
    if (!room) continue
    const ids = [...candidates.values()].filter(item => item.placeId === placeId).map(item => item.id)
      .sort((a, b) => Number(touched.has(b)) - Number(touched.has(a)) || a - b)
    let placed: Readonly<Record<string, StageStandingSpot>> = {}
    for (const id of ids) {
      const entries: StageStandingEntry[] = [
        ...Object.values(placed).map(spot => ({ key: spot.key, kind: 'thing' as const })),
        { key: `thing:${String(id)}`, kind: 'thing' },
      ]
      const next = stageFindFreeSpots(entries, room.standing, placed)
      const spot = next[`thing:${String(id)}`]
      if (!spot) { overflow = true; continue }
      placed = next
    }
    reservations[placeId] = Object.freeze(Object.values(placed))
  }
  return freezePlan(reservations, overflow ? [OVERFLOW_ISSUE] : [])
}

export function createThings(replay: ReplayFile, layout: NestedLayout): ThingSimulation {
  const plan = planThingSpots(replay, layout)
  const things: Record<number, ThingState> = {}
  for (const [key, start] of Object.entries(replay.start)) {
    const match = /^thing:(\d+)$/.exec(key)
    const id = match ? Number(match[1]) : 0
    const spot = validId(id) && start && validId(start.place_id) ? reservationSpot(plan.reservations, id, start.place_id) : null
    if (!validId(id) || !start || !spot) continue
    things[id] = thingAt(spot, null, null)
  }
  return freezeThings(things, plan.reservations, plan.issues, [])
}

export function recordThingIds(replay: ReplayFile): ReadonlySet<number> {
  const ids = new Set<number>()
  for (const key of Object.keys(replay.start)) {
    const match = /^thing:(\d+)$/.exec(key)
    if (match && validId(Number(match[1]))) ids.add(Number(match[1]))
  }
  for (const event of replay.timeline) {
    for (const value of [event.detail.thing_id, event.detail.source_thing_id]) if (validId(value)) ids.add(value)
    if ((event.detail.asset_type === 'thing' || event.detail.type === 'thing') && validId(event.detail.asset_id ?? event.detail.id)) {
      ids.add((event.detail.asset_id ?? event.detail.id) as number)
    }
  }
  return ids
}

export function addPresentThings(
  state: ThingSimulation,
  outline: PlaceOutline,
  layout: NestedLayout,
  recordKnown: ReadonlySet<number>,
  blockers: readonly StageStandingSpot[],
): ThingSimulation {
  const room = layout.rooms[outline.placeId]
  if (!room || outline.quiet || !placeVisible(layout, outline.placeId)) return state
  const additions = outline.things.filter(thing => !recordKnown.has(thing.id) && !state.things[thing.id]).sort((a, b) => a.id - b.id)
  const oldSpots = state.reservations[outline.placeId] ?? []
  const entries: StageStandingEntry[] = additions.map(thing => ({ key: `thing:${thing.id}`, kind: 'thing' as const }))
  const placed = stageFindFreeSpots(entries, room.standing, {}, [], [...oldSpots, ...blockers])
  const things = { ...state.things }
  for (const thing of additions) {
    const spot = placed[`thing:${thing.id}`]
    if (spot) things[thing.id] = thingAt({ id: thing.id, placeId: thing.placeId, x: spot.x + 16, y: spot.y + 16 }, thing.name, null)
  }
  const roomReservations = [...oldSpots, ...Object.values(placed).filter(spot => spot.kind === 'thing')]
  const reservations = { ...state.reservations, [outline.placeId]: roomReservations }
  const shown = additions.filter(thing => things[thing.id]).length
  const omitted = outline.hasMore || shown < additions.length
  const issue = omitted ? `Current read for room ${outline.placeId} lists ${outline.totalItems} things; only the newest items that fit are shown.` : null
  const issues = issue && !state.issues.includes(issue) ? [...state.issues, issue] : state.issues
  return freezeThings(things, freezeReservations(reservations), issues, state.queue)
}

export function reserveLiveThingEvents(
  state: ThingSimulation, events: readonly ReplayEvent[], layout: NestedLayout,
  blockers: ThingReservations = {},
): ThingSimulation {
  const reservations: Record<number, readonly StageStandingSpot[]> = { ...state.reservations }
  let missing = false
  for (const event of events) {
    const placement = createdThing(event) ?? movedThing(event)
    if (!placement) continue
    const room = layout.rooms[placement.placeId]
    if (!room || !placeVisible(layout, placement.placeId)) { missing = true; continue }
    const old = reservations[placement.placeId] ?? []
    if (old.some(spot => spot.key === `thing:${placement.id}`)) continue
    const found = stageFindFreeSpots([{ key: `thing:${placement.id}`, kind: 'thing' }], room.standing, {}, [], [
      ...old, ...(blockers[placement.placeId] ?? []),
    ])[`thing:${placement.id}`]
    if (!found) { missing = true; continue }
    reservations[placement.placeId] = Object.freeze([...old, found])
  }
  const issue = 'Some new thing destinations could not be placed, so no floor position was invented.'
  const issues = missing && !state.issues.includes(issue) ? [...state.issues, issue] : state.issues
  return freezeThings({ ...state.things }, freezeReservations(reservations), issues, state.queue)
}

export function stepThings(state: ThingSimulation, events: readonly ReplayEvent[], nowMs: number): ThingSimulation {
  const things: Record<number, ThingState> = {}
  for (const [idText, thing] of Object.entries(state.things)) {
    if (thing.effect?.kind === 'crumbs' && nowMs >= thing.effect.expiresAt) continue
    things[Number(idText)] = { ...thing, effect: thing.effect && nowMs < thing.effect.expiresAt ? thing.effect : null }
  }
  const queued = [...state.queue, ...events]
  const remaining: ReplayEvent[] = []
  // A thing mid puff or glow holds back its own later rows only, in recorded order.
  // Rows for other things keep playing, so one effect never stalls the whole clock.
  const waiting = new Set<number>()
  for (const event of queued) {
    const affectedId = affectedThingId(event)
    if (affectedId !== null && waiting.has(affectedId)) { remaining.push(event); continue }
    const active = affectedId === null ? null : things[affectedId]?.effect
    if (active?.kind === 'crumbs') continue
    if (affectedId !== null && (active?.kind === 'puff' || active?.kind === 'glow')) {
      waiting.add(affectedId)
      remaining.push(event)
      continue
    }
    const created = createdThing(event)
    if (created) {
      const spot = reservationSpot(state.reservations, created.id, created.placeId)
      if (!spot || things[created.id]) continue
      things[created.id] = thingAt(spot, created.name, makeEffect('puff', nowMs))
      continue
    }
    const moved = movedThing(event)
    if (moved) {
      const thing = things[moved.id]
      const spot = reservationSpot(state.reservations, moved.id, moved.placeId)
      if (spot) things[moved.id] = { ...(thing ?? thingAt(spot, null, null)), ...spot, visible: true, effect: null }
      else if (thing) things[moved.id] = { ...thing, placeId: moved.placeId, visible: false, effect: null }
      continue
    }
    const carriedId = carriedThing(event)
    if (carriedId !== null) {
      const carried = things[carriedId]
      if (carried) things[carriedId] = { ...carried, visible: false, effect: null }
      continue
    }
    const usedId = usedThing(event)
    if (usedId !== null) {
      const thing = things[usedId]
      if (thing?.visible && event.detail.place_id === thing.placeId) {
        things[usedId] = { ...thing, effect: makeEffect('glow', nowMs) }
      }
      continue
    }
    const consumedId = consumedThing(event)
    if (consumedId !== null && things[consumedId]) {
      const thing = things[consumedId]!
      if (thing.visible) things[consumedId] = { ...thing, effect: makeEffect('crumbs', nowMs) }
      else delete things[consumedId]
    }
  }
  return freezeThings(things, state.reservations, state.issues, remaining)
}

export function consumedThing(event: ReplayEvent): number | null {
  if (event.kind === 'thing_withdrawn' && validId(event.detail.thing_id)) return event.detail.thing_id
  if (event.kind === 'action' && event.detail.action === 'consume' && event.detail.status === 'applied' &&
      event.detail.error == null && validId(event.detail.source_thing_id) && validId(event.detail.place_id)) return event.detail.source_thing_id
  return null
}

export function effectFrame(effect: ThingEffect, nowMs: number): EffectFrame {
  const duration = Math.max(1, effect.expiresAt - effect.startedAt)
  const raw = (nowMs - effect.startedAt) / duration
  const progress = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0
  const active = Number.isFinite(nowMs) && nowMs >= effect.startedAt && nowMs < effect.expiresAt
  return Object.freeze({ progress, puff: active && effect.kind === 'puff', glow: active && effect.kind === 'glow', crumbs: active && effect.kind === 'crumbs' })
}

export function createdThing(event: ReplayEvent): CreatedThing | null {
  if (event.kind !== 'thing_created' || !validId(event.detail.thing_id) || !validId(event.detail.place_id)) return null
  const name = typeof event.detail.name === 'string' && event.detail.name.trim().length ? event.detail.name.trim() : null
  return Object.freeze({ id: event.detail.thing_id, placeId: event.detail.place_id, name })
}

export function movedThing(event: ReplayEvent): MovedThing | null {
  return event.kind === 'thing_moved' && validId(event.detail.thing_id) && validId(event.detail.place_id)
    ? Object.freeze({ id: event.detail.thing_id, placeId: event.detail.place_id }) : null
}

export function usedThing(event: ReplayEvent): number | null {
  return event.kind === 'action' && event.detail.action === 'use' && (event.detail.status === 'applied' || event.detail.status === 'noop') &&
      event.detail.error == null && validId(event.detail.place_id) && validId(event.detail.source_thing_id)
    ? event.detail.source_thing_id : null
}

function touchedThingIds(events: readonly ReplayEvent[]): ReadonlySet<number> {
  const result = new Set<number>()
  for (const event of events) {
    for (const value of [event.detail.thing_id, event.detail.source_thing_id]) if (validId(value)) result.add(value)
  }
  return result
}

// A thing_moved row with no place is a pick-up: the thing is in someone's hands, not on a floor.
function carriedThing(event: ReplayEvent): number | null {
  return event.kind === 'thing_moved' && validId(event.detail.thing_id) && !validId(event.detail.place_id)
    ? event.detail.thing_id : null
}

function affectedThingId(event: ReplayEvent): number | null {
  return createdThing(event)?.id ?? movedThing(event)?.id ?? carriedThing(event) ?? usedThing(event) ?? consumedThing(event)
}

function makeEffect(kind: ThingEffectKind, nowMs: number): ThingEffect {
  const duration = EFFECT_MS[kind]
  return Object.freeze({ kind, startedAt: nowMs, expiresAt: nowMs + duration })
}

function reservationSpot(reservations: ThingReservations, id: number, wantedPlaceId?: number): ThingSpot | null {
  for (const [placeText, spots] of Object.entries(reservations)) {
    if (wantedPlaceId !== undefined && Number(placeText) !== wantedPlaceId) continue
    const found = spots.find(spot => spot.key === `thing:${String(id)}`)
    if (found) return Object.freeze({ id, placeId: Number(placeText), x: found.x + 16, y: found.y + 16 })
  }
  return null
}

function thingAt(spot: ThingSpot, name: string | null, effect: ThingEffect | null): ThingState {
  return Object.freeze({ ...spot, name, visible: true, effect })
}

function placeVisible(layout: NestedLayout, placeId: number): boolean {
  const visited = new Set<number>()
  let room = layout.rooms[placeId]
  if (!room) return false
  while (room && !visited.has(room.id)) {
    if (room.quiet) return false
    visited.add(room.id)
    room = room.parentId === null ? undefined : layout.rooms[room.parentId]
  }
  return true
}

function validId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function freezePlan(reservations: Record<number, readonly StageStandingSpot[]>, issues: readonly string[]): ThingPlan {
  return Object.freeze({ reservations: freezeReservations(reservations), issues: Object.freeze([...issues]) })
}

function freezeReservations(reservations: Record<number, readonly StageStandingSpot[]>): ThingReservations {
  return Object.freeze(Object.fromEntries(Object.entries(reservations).map(([id, spots]) => [id, Object.freeze([...spots])])))
}

function freezeThings(things: Record<number, ThingState>, reservations: ThingReservations, issues: readonly string[], queue: readonly ReplayEvent[]): ThingSimulation {
  const frozen = Object.freeze(Object.fromEntries(Object.entries(things).map(([id, thing]) => [id, Object.freeze({ ...thing })])))
  const frozenQueue = Object.freeze([...queue])
  return Object.freeze({ things: frozen, reservations, issues: Object.freeze([...issues]), queue: frozenQueue, pending: frozenQueue.length > 0 || Object.values(frozen).some(thing => thing.effect !== null) })
}
