import type { ReplayEvent, ReplayFile } from './city/types.ts'
import type { NestedLayout } from './ground/nested.ts'
import { stageFindFreeSpots, type StageStandingEntry, type StageStandingSpot } from './ground/stage-ground.ts'
import { BASE_SPEED, holdScale } from './replay/index.ts'

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
  spots: Readonly<Record<number, ThingSpot>>
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

const EFFECT_MS: Readonly<Record<ThingEffectKind, number>> = { puff: 900, glow: 800, crumbs: 700 }
const EFFECT_FLOOR_MS = 250
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
  const spots: Record<number, ThingSpot> = {}
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
      if (!spots[id]) spots[id] = Object.freeze({ id, placeId, x: spot.x + 16, y: spot.y + 16 })
    }
    reservations[placeId] = Object.freeze(Object.values(placed))
  }
  return freezePlan(spots, reservations, overflow ? [OVERFLOW_ISSUE] : [])
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

export function stepThings(state: ThingSimulation, events: readonly ReplayEvent[], nowMs: number, speed: number = BASE_SPEED): ThingSimulation {
  const things: Record<number, ThingState> = {}
  for (const [idText, thing] of Object.entries(state.things)) {
    if (thing.effect?.kind === 'crumbs' && nowMs >= thing.effect.expiresAt) continue
    things[Number(idText)] = { ...thing, effect: thing.effect && nowMs < thing.effect.expiresAt ? thing.effect : null }
  }
  const queued = [...state.queue, ...events]
  let remaining: readonly ReplayEvent[] = []
  for (let index = 0; index < queued.length; index += 1) {
    const event = queued[index]!
    const affectedId = affectedThingId(event)
    const active = affectedId === null ? null : things[affectedId]?.effect
    if (active?.kind === 'crumbs') continue
    if (active && (active.kind === 'puff' || active.kind === 'glow')) {
      remaining = queued.slice(index)
      break
    }
    const created = createdThing(event)
    if (created) {
      const spot = reservationSpot(state.reservations, created.id, created.placeId)
      if (!spot || things[created.id]) continue
      things[created.id] = thingAt(spot, created.name, makeEffect('puff', nowMs, speed))
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
    const usedId = usedThing(event)
    if (usedId !== null) {
      const thing = things[usedId]
      if (thing?.visible && event.detail.place_id === thing.placeId) {
        things[usedId] = { ...thing, effect: makeEffect('glow', nowMs, speed) }
      }
      continue
    }
    const consumedId = consumedThing(event)
    if (consumedId !== null && things[consumedId]) {
      const thing = things[consumedId]!
      if (thing.visible) things[consumedId] = { ...thing, effect: makeEffect('crumbs', nowMs, speed) }
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

function affectedThingId(event: ReplayEvent): number | null {
  return createdThing(event)?.id ?? movedThing(event)?.id ?? usedThing(event) ?? consumedThing(event)
}

function makeEffect(kind: ThingEffectKind, nowMs: number, speed: number): ThingEffect {
  const scale = holdScale(speed)
  const duration = Math.max(EFFECT_FLOOR_MS, EFFECT_MS[kind] * scale)
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

function freezePlan(spots: Record<number, ThingSpot>, reservations: Record<number, readonly StageStandingSpot[]>, issues: readonly string[]): ThingPlan {
  return Object.freeze({ spots: Object.freeze({ ...spots }), reservations: freezeReservations(reservations), issues: Object.freeze([...issues]) })
}

function freezeReservations(reservations: Record<number, readonly StageStandingSpot[]>): ThingReservations {
  return Object.freeze(Object.fromEntries(Object.entries(reservations).map(([id, spots]) => [id, Object.freeze([...spots])])))
}

function freezeThings(things: Record<number, ThingState>, reservations: ThingReservations, issues: readonly string[], queue: readonly ReplayEvent[]): ThingSimulation {
  const frozen = Object.freeze(Object.fromEntries(Object.entries(things).map(([id, thing]) => [id, Object.freeze({ ...thing })])))
  const frozenQueue = Object.freeze([...queue])
  return Object.freeze({ things: frozen, reservations, issues: Object.freeze([...issues]), queue: frozenQueue, pending: frozenQueue.length > 0 || Object.values(frozen).some(thing => thing.effect !== null) })
}
