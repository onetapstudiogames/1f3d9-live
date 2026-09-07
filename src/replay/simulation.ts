import type { ReplayEvent, ReplayFile, Resident } from '../city/types.ts'
import { initialResidents, residentIndex } from '../city/residents.ts'
import type { NestedLayout, Point } from '../ground/nested.ts'
import { pointAlongPath, walkPath } from '../ground/path.ts'
import { stageFindFreeSpots, type StageStandingSpot } from '../ground/stage-ground.ts'
import { appliedMove, bubbleFor, bubbleVisible, walkDuration, BASE_SPEED } from './index.ts'

type QueuedEvent = Readonly<{ event: ReplayEvent }>

export type ResidentState = Readonly<{
  id: number
  handle: string
  placeId: number | null
  x: number
  y: number
  flipX: boolean
  walking: boolean
  visible: boolean
  bubble: Readonly<{ text: string; cut: boolean; expiresAt: number }> | null
  queue: readonly QueuedEvent[]
  path: readonly Point[]
  walkElapsed: number
  walkDuration: number
  destinationId: number | null
  destination: Point | null
}>

export type Simulation = Readonly<{
  residents: Readonly<Record<number, ResidentState>>
  actors: ReadonlyMap<string, number>
  pending: boolean
  issues: readonly string[]
}>

export function roomCapacity(replay: ReplayFile, census: readonly Resident[]): Readonly<Record<number, number>> {
  const handles = residentIndex(census)
  const occupants = new Map<number, Set<string>>()
  const add = (placeId: unknown, key: string | undefined): void => {
    if (!validPlace(placeId) || key === undefined) return
    const held = occupants.get(placeId) ?? new Set<string>()
    held.add(key)
    occupants.set(placeId, held)
  }
  for (const resident of initialResidents(replay, census)) add(resident.placeId, `id:${String(resident.id)}`)
  for (const event of replay.timeline) {
    const actor = typeof event.actor === 'string' && event.actor.length ? event.actor : null
    const known = actor === null ? undefined : handles.get(actor)?.id
    const key = known !== undefined
      ? `id:${String(known)}`
      : actor !== null ? `handle:${actor}` : `event:${String(event.event_id)}:unknown`
    add(event.detail.from_place_id, key)
    add(event.detail.to_place_id, key)
    add(event.detail.place_id, key)
  }
  return Object.freeze(Object.fromEntries([...occupants].map(([id, ids]) => [id, ids.size])))
}

export function createResidents(
  replay: ReplayFile,
  census: readonly Resident[],
  layout: NestedLayout,
): Simulation {
  const initial = new Map(initialResidents(replay, census).map(item => [item.id, item]))
  const residents: Record<number, ResidentState> = {}
  const actors = new Map<string, number>()
  for (const resident of census) {
    if (typeof resident.handle !== 'string' || resident.handle.length === 0) continue
    actors.set(resident.handle, resident.id)
    const item = initial.get(resident.id)
    residents[resident.id] = baseResident(resident.id, resident.handle, item?.placeId ?? null)
  }
  for (const [key, start] of Object.entries(replay.start)) {
    const match = /^resident:(\d+)$/.exec(key)
    if (!match || start === null) continue
    const id = Number(match[1])
    if (!Number.isSafeInteger(id) || residents[id]) continue
    residents[id] = baseResident(id, key, start.place_id)
  }
  placeStationary(residents, layout)
  return freezeSimulation(residents, actors, [], false)
}

export function stepResidents(
  state: Simulation,
  events: readonly ReplayEvent[],
  deltaMs: number,
  nowMs: number,
  layout: NestedLayout,
  speed: number = BASE_SPEED,
): Simulation {
  const residents: Record<number, ResidentState> = Object.fromEntries(
    Object.entries(state.residents).map(([id, resident]) => [id, { ...resident, queue: [...resident.queue], path: [...resident.path] }]),
  )
  const issues = [...state.issues]
  for (const event of events) {
    if (event.actor === null) continue
    const actor = typeof event.actor === 'string' ? event.actor : ''
    const id = state.actors.get(actor)
    if (id === undefined || !residents[id]) {
      addIssue(issues, 'actor')
      continue
    }
    residents[id] = { ...residents[id]!, queue: [...residents[id]!.queue, { event }] }
  }

  const elapsed = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0
  for (const id of Object.keys(residents).map(Number).sort((a, b) => a - b)) {
    let resident = residents[id]!
    if (resident.bubble && !bubbleVisible(resident.bubble.expiresAt, nowMs)) resident = { ...resident, bubble: null }
    if (resident.walking) resident = advanceWalk(resident, elapsed, layout)
    if (!resident.walking && !resident.bubble) resident = startNext(resident, residents, nowMs, layout, issues, speed)
    residents[id] = resident
  }
  return freezeSimulation(residents, state.actors, issues, Object.values(residents).some(isPending))
}

function startNext(
  resident: ResidentState,
  all: Readonly<Record<number, ResidentState>>,
  nowMs: number,
  layout: NestedLayout,
  issues: string[],
  speed: number,
): ResidentState {
  let next = resident
  while (next.queue.length) {
    const queued = next.queue[0]!
    const event = queued.event
    const queue = next.queue.slice(1)
    const detail = event.detail
    const isApplied = event.kind === 'action' && (detail.action === 'move' || detail.action === 'go_home') && detail.status === 'applied' && !('error' in detail && detail.error != null)
    const isNoopAnchor = event.kind === 'action' && (detail.action === 'move' || detail.action === 'go_home') && detail.status === 'noop' &&
      validPlace(detail.from_place_id) && detail.from_place_id === detail.to_place_id
    if (isNoopAnchor && next.placeId !== detail.from_place_id && layout.rooms[detail.from_place_id]) {
      const source = freeDestination(next.id, detail.from_place_id, all, layout)
      if (source) {
        // A first placement skips nothing; only a figure that already stood somewhere lost a route.
        if (next.placeId !== null) addIssue(issues, 'route-gap')
        next = { ...next, queue, placeId: detail.from_place_id, x: source.x, y: source.y, visible: placeVisible(layout, detail.from_place_id) }
        continue
      }
    }
    if (isApplied && validPlace(detail.from_place_id) && validPlace(detail.to_place_id)) {
      const fromId = detail.from_place_id
      const toId = detail.to_place_id
      if (!layout.rooms[fromId] || !layout.rooms[toId]) {
        addIssue(issues, 'room')
        next = { ...next, queue }
        continue
      }
      if (next.placeId === null) {
        const source = freeDestination(next.id, fromId, all, layout)
        if (!source) {
          addIssue(issues, 'placement')
          next = { ...next, queue }
          continue
        }
        next = { ...next, placeId: fromId, x: source.x, y: source.y, visible: placeVisible(layout, fromId) }
      }
      if (next.placeId !== fromId) {
        const source = freeDestination(next.id, fromId, all, layout)
        if (!source) {
          addIssue(issues, 'placement')
          next = { ...next, queue }
          continue
        }
        addIssue(issues, 'route-gap')
        next = { ...next, placeId: fromId, x: source.x, y: source.y, visible: placeVisible(layout, fromId) }
      }
      // A same-room applied move only anchors the figure; appliedMove says when there is a real walk.
      const walk = appliedMove(event)
      if (!walk) {
        next = { ...next, queue }
        continue
      }
      const destination = freeDestination(next.id, walk.toId, all, layout)
      if (!destination) {
        addIssue(issues, 'placement')
        next = { ...next, queue }
        continue
      }
      const path = walkPath(layout, walk.fromId, walk.toId, { x: next.x, y: next.y }, destination)
      if (path.length < 2) {
        addIssue(issues, 'route')
        next = { ...next, queue }
        continue
      }
      const distance = path.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - path[index]!.x, point.y - path[index]!.y), 0)
      return { ...next, queue, walking: true, path, walkElapsed: 0, walkDuration: walkDuration(distance, speed), destinationId: walk.toId, destination, bubble: null }
    }
    if (event.kind === 'note') {
      next = handleNote(next, event, queue, all, nowMs, layout, issues, speed)
      if (next.bubble) return next
      continue
    }
    next = { ...next, queue }
  }
  return next
}

function handleNote(
  resident: ResidentState,
  event: ReplayEvent,
  queue: readonly QueuedEvent[],
  all: Readonly<Record<number, ResidentState>>,
  nowMs: number,
  layout: NestedLayout,
  issues: string[],
  speed: number,
): ResidentState {
  const recordedPlace = event.detail.place_id
  if (validPlace(recordedPlace) && !layout.rooms[recordedPlace]) {
    addIssue(issues, 'room')
    return { ...resident, queue }
  }
  const placeId = validPlace(recordedPlace) ? recordedPlace : resident.placeId
  let next = resident
  if (placeId !== null && resident.placeId !== placeId) {
    const destination = freeDestination(resident.id, placeId, all, layout)
    if (!destination) {
      addIssue(issues, 'placement')
      return { ...resident, queue }
    }
    if (resident.placeId !== null) addIssue(issues, 'route-gap')
    next = { ...resident, placeId, x: destination.x, y: destination.y, visible: placeVisible(layout, placeId) }
  }
  return { ...next, queue, bubble: bubbleFor(event, nowMs, speed) }
}

function advanceWalk(resident: ResidentState, deltaMs: number, layout: NestedLayout): ResidentState {
  const walkElapsed = Math.min(resident.walkDuration, resident.walkElapsed + deltaMs)
  const sampled = pointAlongPath(resident.path, resident.walkDuration ? walkElapsed / resident.walkDuration : 1)
  if (!sampled.done) return { ...resident, walkElapsed, x: sampled.x, y: sampled.y, flipX: sampled.flipX, visible: visibleAt(sampled, layout) }
  const placeId = resident.destinationId
  return { ...resident, placeId, x: sampled.x, y: sampled.y, flipX: sampled.flipX, walking: false, visible: placeId !== null && placeVisible(layout, placeId), path: [], walkElapsed: 0, walkDuration: 0, destinationId: null, destination: null }
}

function freeDestination(id: number, placeId: number, all: Readonly<Record<number, ResidentState>>, layout: NestedLayout): Point | null {
  const room = layout.rooms[placeId]
  if (!room) return null
  // A figure that is walking away has left; it holds a spot only in the room it walks to,
  // and holds it at its chosen destination, never at wherever this frame happened to draw it.
  const holds = (item: ResidentState): boolean => item.walking ? item.destinationId === placeId : item.placeId === placeId
  const eligible = Object.values(all).filter(item => item.id === id || holds(item))
  const previous: Record<string, StageStandingSpot> = {}
  for (const item of eligible) {
    const point = item.id === id ? null : item.walking ? item.destination : { x: item.x, y: item.y }
    if (point) previous[`resident:${String(item.id)}`] = { key: `resident:${String(item.id)}`, kind: 'resident', x: point.x - 16, y: point.y - 16, width: 32, height: 32 }
  }
  const spots = stageFindFreeSpots(eligible.map(item => ({ key: `resident:${String(item.id)}`, kind: 'resident' as const })), room.standing, previous)
  const spot = spots[`resident:${String(id)}`]
  return spot ? Object.freeze({ x: spot.x + 16, y: spot.y + 16 }) : null
}

function placeStationary(residents: Record<number, ResidentState>, layout: NestedLayout): void {
  for (const placeId of new Set(Object.values(residents).map(item => item.placeId).filter((id): id is number => id !== null))) {
    const room = layout.rooms[placeId]
    if (!room) continue
    const entries = Object.values(residents).filter(item => item.placeId === placeId).map(item => ({ key: `resident:${String(item.id)}`, kind: 'resident' as const }))
    const spots = stageFindFreeSpots(entries, room.standing)
    for (const item of Object.values(residents).filter(value => value.placeId === placeId)) {
      const spot = spots[`resident:${String(item.id)}`]
      if (spot) residents[item.id] = { ...item, x: spot.x + 16, y: spot.y + 16, visible: placeVisible(layout, placeId) }
    }
  }
}

function visibleAt(point: Point, layout: NestedLayout): boolean {
  const containing = Object.values(layout.rooms).filter(room => point.x >= room.x && point.x <= room.x + room.width && point.y >= room.y && point.y <= room.y + room.height).sort((a, b) => b.depth - a.depth)[0]
  return containing ? placeVisible(layout, containing.id) : true
}

function placeVisible(layout: NestedLayout, placeId: number): boolean {
  const visited = new Set<number>()
  let room = layout.rooms[placeId]
  while (room && !visited.has(room.id)) {
    if (room.quiet) return false
    visited.add(room.id)
    room = room.parentId === null ? undefined : layout.rooms[room.parentId]
  }
  return true
}

function baseResident(id: number, handle: string, placeId: number | null): ResidentState {
  return { id, handle, placeId, x: 0, y: 0, flipX: false, walking: false, visible: false, bubble: null, queue: [], path: [], walkElapsed: 0, walkDuration: 0, destinationId: null, destination: null }
}

function isPending(resident: ResidentState): boolean {
  return resident.walking || resident.bubble !== null || resident.queue.length > 0
}

function freezeSimulation(residents: Record<number, ResidentState>, actors: ReadonlyMap<string, number>, issues: readonly string[], pending: boolean): Simulation {
  const frozen = Object.fromEntries(Object.entries(residents).map(([id, resident]) => [id, Object.freeze({ ...resident, queue: Object.freeze([...resident.queue]), path: Object.freeze([...resident.path]) })]))
  return Object.freeze({ residents: Object.freeze(frozen), actors: new Map(actors), pending, issues: Object.freeze([...issues]) })
}

function validPlace(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

// One plain sentence per kind of trouble. It names no resident and gives no count,
// because the record did not give one; the city's own tabs hold the exact numbers.
const ISSUE_WORDS = {
  'route-gap': 'The record skips part of some routes; those figures reappear at their next recorded room.',
  actor: 'Some recorded events name residents the resident list does not know; they are not drawn.',
  room: 'Some recorded events name a room the map does not show; those are not drawn.',
  placement: 'Some rooms had no free spot left, so those figures were not moved into them.',
  route: 'Some recorded walks have no path on the map; those figures stay where the record last placed them.',
} as const

type IssueKind = keyof typeof ISSUE_WORDS

function addIssue(issues: string[], kind: IssueKind): void {
  const message = ISSUE_WORDS[kind]
  if (!issues.includes(message)) issues.push(message)
}
