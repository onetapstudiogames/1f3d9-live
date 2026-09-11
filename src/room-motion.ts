import type { Point, Room } from './ground/nested.ts'
import { ROOM_RESIDENT_SIZE } from './room-appearance.ts'

export const ROOM_WALK_SPEED = 140
export const IDLE_DRIFT_SPEED = 20

export function roomMovesConflict(left: Readonly<{ fromId: number | null; toId: number }>,
  right: Readonly<{ fromId: number | null; toId: number }>): boolean {
  return [left.fromId, left.toId].some(id => id !== null && (id === right.fromId || id === right.toId))
}

const RESIDENT_SIZE = ROOM_RESIDENT_SIZE
const MOTION_GAP = 4
const WALK_RADIUS = RESIDENT_SIZE / 2 + MOTION_GAP
const DOOR_OUTSIDE_DISTANCE = WALK_RADIUS + 2
const EPSILON = 0.01

export type MotionRect = Readonly<{ x: number; y: number; width: number; height: number }>
export type RoomWalkPlan = Readonly<{
  fromId: number | null
  toId: number
  departure: readonly Point[]
  arrival: readonly Point[]
  departureDistance: number
  arrivalDistance: number
  distance: number
  durationMs: number
}>
export type RoomWalkSample = Readonly<{
  x: number
  y: number
  roomId: number
  phase: 'departure' | 'arrival' | 'done'
  done: boolean
  flipX: boolean
}>

export type IdleDriftPlan = Readonly<{
  from: Point
  to: Point
  distance: number
  durationMs: number
}>

export type IdleDriftSample = Readonly<Point & { done: boolean; flipX: boolean }>

export function createRoomWalk(
  fromRoom: Room | undefined,
  toRoom: Room,
  origin: Point,
  target: Point,
  sourceObstacles: readonly MotionRect[],
  targetObstacles: readonly MotionRect[],
): RoomWalkPlan | null {
  if (!validRoom(toRoom) || !validPoint(target) || !validRects(targetObstacles)) return null
  const arrival = createArrival(toRoom, target, targetObstacles)
  if (!arrival) return null

  let departure: readonly Point[] = Object.freeze([])
  if (fromRoom) {
    const planned = createDeparture(fromRoom, origin, sourceObstacles)
    if (!planned) return null
    departure = planned
  }
  const departureDistance = pathDistance(departure)
  const arrivalDistance = pathDistance(arrival)
  const distance = departureDistance + arrivalDistance
  return Object.freeze({ fromId: fromRoom?.id ?? null, toId: toRoom.id, departure, arrival,
    departureDistance, arrivalDistance, distance, durationMs: distance / ROOM_WALK_SPEED * 1_000 })
}

export function createDeparture(room: Room, origin: Point,
  obstacles: readonly MotionRect[]): readonly Point[] | null {
  if (!validRoom(room) || !validPoint(origin) || !validRects(obstacles)) return null
  const inside = routeInsideRoom(room, origin, room.door, obstacles)
  return inside ? freezePoints([...inside, outsideDoor(room)]) : null
}

export function createArrival(room: Room, target: Point,
  obstacles: readonly MotionRect[]): readonly Point[] | null {
  if (!validRoom(room) || !validPoint(target) || !validRects(obstacles)) return null
  const inside = routeInsideRoom(room, room.door, target, obstacles)
  return inside ? freezePoints(inside) : null
}

export function createRoomPath(room: Room, from: Point, to: Point,
  obstacles: readonly MotionRect[]): readonly Point[] | null {
  if (!validRoom(room) || !validPoint(from) || !validPoint(to) || !validRects(obstacles)) return null
  return routeInsideRoom(room, from, to, obstacles)
}

export function motionSegmentClear(from: Point, to: Point, occupied: readonly MotionRect[]): boolean {
  return validPoint(from) && validPoint(to) && validRects(occupied) && segmentClear(from, to, occupied)
}

export function sampleRoomWalk(plan: RoomWalkPlan, elapsedMs: number): RoomWalkSample {
  const elapsed = Math.max(0, finite(elapsedMs, 0))
  if (elapsed >= plan.durationMs) {
    const point = plan.arrival.length ? samplePath(plan.arrival, plan.arrivalDistance) :
      samplePath(plan.departure, plan.departureDistance)
    return Object.freeze({ ...point, roomId: plan.toId, phase: 'done', done: true })
  }
  const travelled = elapsed / 1_000 * ROOM_WALK_SPEED
  if (plan.departure.length && travelled < plan.departureDistance) {
    const point = samplePath(plan.departure, travelled)
    return Object.freeze({ ...point, roomId: plan.fromId!, phase: 'departure', done: false })
  }
  const arrivalTravelled = Math.max(0, travelled - plan.departureDistance)
  if (arrivalTravelled < plan.arrivalDistance) {
    const point = samplePath(plan.arrival, arrivalTravelled)
    return Object.freeze({ ...point, roomId: plan.toId, phase: 'arrival', done: false })
  }
  const point = samplePath(plan.arrival, plan.arrivalDistance)
  return Object.freeze({ ...point, roomId: plan.toId, phase: 'done', done: true })
}

export function arrivalSpot(
  room: Room,
  preferred: Point,
  occupied: readonly MotionRect[],
  candidates: readonly Point[] = [],
): Point | null {
  if (!validRoom(room) || !validRects(occupied)) return null
  const generated: Point[] = []
  const half = RESIDENT_SIZE / 2
  const minX = room.standing.x + half; const maxX = room.standing.x + room.standing.width - half
  const minY = room.standing.y + half; const maxY = room.standing.y + room.standing.height - half
  if (maxX >= minX && maxY >= minY) {
    for (let y = minY; y <= maxY; y += RESIDENT_SIZE + MOTION_GAP) {
      for (let x = minX; x <= maxX; x += RESIDENT_SIZE + MOTION_GAP) generated.push({ x, y })
    }
  }
  const seen = new Set<string>()
  for (const point of [preferred, ...candidates, ...generated]) {
    if (!validPoint(point)) continue
    const key = `${point.x}:${point.y}`
    if (seen.has(key)) continue
    seen.add(key)
    if (!residentFits(point, room.standing, occupied)) continue
    if (routeInsideRoom(room, room.door, point, occupied)) return Object.freeze({ ...point })
  }
  return null
}

export function idleDriftDueAt(residentId: number, afterMs: number): number {
  const base = finite(afterMs, 0)
  return base + 9_000 + hash(residentId, Math.floor(base / 1_000)) % 2_001
}

export function createIdleDrift(
  residentId: number,
  turn: number,
  room: Room,
  origin: Point,
  occupied: readonly MotionRect[],
): IdleDriftPlan | null {
  if (!validRoom(room) || !validPoint(origin) || !validRects(occupied)) return null
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const seed = hash(residentId + attempt * 97, turn)
    const angle = seed / 0xffffffff * Math.PI * 2
    const wanted = 12 + (seed >>> 12) % 13
    const to = Object.freeze({ x: origin.x + Math.cos(angle) * wanted, y: origin.y + Math.sin(angle) * wanted })
    if (!residentFits(to, room.standing, occupied) || !segmentClear(origin, to, occupied)) continue
    const distance = Math.hypot(to.x - origin.x, to.y - origin.y)
    return Object.freeze({ from: Object.freeze({ ...origin }), to, distance,
      durationMs: distance / IDLE_DRIFT_SPEED * 1_000 })
  }
  return null
}

export function sampleIdleDrift(plan: IdleDriftPlan, elapsedMs: number): IdleDriftSample {
  const share = plan.durationMs <= 0 ? 1 : Math.min(1, Math.max(0, finite(elapsedMs, 0) / plan.durationMs))
  return Object.freeze({ x: plan.from.x + (plan.to.x - plan.from.x) * share,
    y: plan.from.y + (plan.to.y - plan.from.y) * share,
    done: share >= 1, flipX: plan.to.x < plan.from.x })
}

function routeInsideRoom(room: Room, from: Point, to: Point, obstacles: readonly MotionRect[]): readonly Point[] | null {
  if (!pointInRoom(from, room, true) || !pointInRoom(to, room, true)) return null
  const fromIsDoor = samePoint(from, room.door); const toIsDoor = samePoint(to, room.door)
  const innerDoor = insideDoor(room)
  const routeFrom = fromIsDoor ? innerDoor : from
  const routeTo = toIsDoor ? innerDoor : to
  const expanded = obstacles.map(rect => expandRect(rect, WALK_RADIUS))
  if (expanded.some(rect => pointInsideRect(routeFrom, rect) || pointInsideRect(routeTo, rect))) return null
  const inner = { x: room.x + WALK_RADIUS, y: room.y + WALK_RADIUS,
    width: room.width - WALK_RADIUS * 2, height: room.height - WALK_RADIUS * 2 }
  const nodes: Point[] = [routeFrom, routeTo]
  for (const rect of expanded) {
    for (const point of [
      { x: rect.x - EPSILON, y: rect.y - EPSILON },
      { x: rect.x + rect.width + EPSILON, y: rect.y - EPSILON },
      { x: rect.x + rect.width + EPSILON, y: rect.y + rect.height + EPSILON },
      { x: rect.x - EPSILON, y: rect.y + rect.height + EPSILON },
    ]) if (pointInRect(point, inner)) nodes.push(Object.freeze(point))
  }
  const distances = nodes.map(() => Number.POSITIVE_INFINITY); distances[0] = 0
  const previous = nodes.map(() => -1); const visited = new Set<number>()
  while (visited.size < nodes.length) {
    let current = -1
    for (let index = 0; index < nodes.length; index += 1) {
      if (!visited.has(index) && (current < 0 || distances[index]! < distances[current]!)) current = index
    }
    if (current < 0 || !Number.isFinite(distances[current])) break
    if (current === 1) break
    visited.add(current)
    for (let next = 0; next < nodes.length; next += 1) {
      if (visited.has(next) || next === current || !visibleSegment(nodes[current]!, nodes[next]!, room, expanded)) continue
      const candidate = distances[current]! + Math.hypot(nodes[next]!.x - nodes[current]!.x, nodes[next]!.y - nodes[current]!.y)
      if (candidate < distances[next]!) { distances[next] = candidate; previous[next] = current }
    }
  }
  if (!Number.isFinite(distances[1])) return null
  const result: Point[] = []; let cursor = 1
  while (cursor >= 0) { result.push(nodes[cursor]!); cursor = previous[cursor]! }
  const routed = result.reverse()
  return freezePoints([...(fromIsDoor ? [from] : []), ...routed, ...(toIsDoor ? [to] : [])])
}

function visibleSegment(from: Point, to: Point, room: Room, obstacles: readonly MotionRect[]): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4))
  for (let index = 0; index <= steps; index += 1) {
    const share = index / steps
    const point = { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share }
    const endpointDoor = (index === 0 && samePoint(from, room.door)) || (index === steps && samePoint(to, room.door))
    if (!endpointDoor && !pointInRoom(point, room, false)) return false
    if (obstacles.some(rect => pointInsideRect(point, rect))) return false
  }
  return true
}

function outsideDoor(room: Room): Point {
  const door = room.door
  // A single-room layout has symmetric outer insets. Clear the inferred viewport edge
  // by the resident half-size, gap and bob so the last departure frame is truly offscreen.
  if (Math.abs(door.x - room.x) < EPSILON) return Object.freeze({ x: -DOOR_OUTSIDE_DISTANCE, y: door.y })
  if (Math.abs(door.x - (room.x + room.width)) < EPSILON) return Object.freeze({ x: room.x * 2 + room.width + DOOR_OUTSIDE_DISTANCE, y: door.y })
  if (Math.abs(door.y - room.y) < EPSILON) return Object.freeze({ x: door.x, y: -DOOR_OUTSIDE_DISTANCE })
  return Object.freeze({ x: door.x, y: room.y * 2 + room.height + DOOR_OUTSIDE_DISTANCE })
}

function insideDoor(room: Room): Point {
  const door = room.door
  if (Math.abs(door.x - room.x) < EPSILON) return Object.freeze({ x: room.x + WALK_RADIUS, y: door.y })
  if (Math.abs(door.x - (room.x + room.width)) < EPSILON) return Object.freeze({ x: room.x + room.width - WALK_RADIUS, y: door.y })
  if (Math.abs(door.y - room.y) < EPSILON) return Object.freeze({ x: door.x, y: room.y + WALK_RADIUS })
  return Object.freeze({ x: door.x, y: room.y + room.height - WALK_RADIUS })
}

function samplePath(path: readonly Point[], distance: number): Readonly<Point & { flipX: boolean }> {
  if (!path.length) return Object.freeze({ x: 0, y: 0, flipX: false })
  let remaining = Math.max(0, distance)
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]!; const to = path[index]!
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (remaining < length && length > 0) {
      const share = remaining / length
      return Object.freeze({ x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share,
        flipX: to.x < from.x })
    }
    remaining -= length
  }
  const last = path.at(-1)!; const before = path.at(-2) ?? last
  return Object.freeze({ ...last, flipX: last.x < before.x })
}

function pathDistance(path: readonly Point[]): number {
  return path.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - path[index]!.x, point.y - path[index]!.y), 0)
}

function residentFits(point: Point, area: MotionRect, occupied: readonly MotionRect[]): boolean {
  const half = RESIDENT_SIZE / 2
  const resident = { x: point.x - half, y: point.y - half, width: RESIDENT_SIZE, height: RESIDENT_SIZE }
  return resident.x >= area.x && resident.y >= area.y && resident.x + resident.width <= area.x + area.width &&
    resident.y + resident.height <= area.y + area.height && !occupied.some(rect => overlapsWithGap(resident, rect))
}

function segmentClear(from: Point, to: Point, occupied: readonly MotionRect[]): boolean {
  return occupied.every(rect => !segmentCrossesRect(from, to, expandRect(rect, WALK_RADIUS)))
}

function segmentCrossesRect(from: Point, to: Point, rect: MotionRect): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 2))
  for (let index = 0; index <= steps; index += 1) {
    const share = index / steps
    if (pointInsideRect({ x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share }, rect)) return true
  }
  return false
}

function overlapsWithGap(left: MotionRect, right: MotionRect): boolean {
  return left.x < right.x + right.width + MOTION_GAP && left.x + left.width + MOTION_GAP > right.x &&
    left.y < right.y + right.height + MOTION_GAP && left.y + left.height + MOTION_GAP > right.y
}

function expandRect(rect: MotionRect, amount: number): MotionRect {
  return Object.freeze({ x: rect.x - amount, y: rect.y - amount,
    width: rect.width + amount * 2, height: rect.height + amount * 2 })
}

function pointInsideRect(point: Point, rect: MotionRect): boolean {
  return point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height
}

function pointInRect(point: Point, rect: MotionRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

function pointInRoom(point: Point, room: Room, allowDoor: boolean): boolean {
  if (allowDoor && samePoint(point, room.door)) return true
  return point.x >= room.x + WALK_RADIUS && point.x <= room.x + room.width - WALK_RADIUS &&
    point.y >= room.y + WALK_RADIUS && point.y <= room.y + room.height - WALK_RADIUS
}

function samePoint(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) < EPSILON && Math.abs(left.y - right.y) < EPSILON
}

function validPoint(point: Point): boolean { return Number.isFinite(point?.x) && Number.isFinite(point?.y) }
function validRects(rects: readonly MotionRect[]): boolean {
  return rects.every(rect => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width >= 0 && rect.height >= 0)
}
function validRoom(room: Room): boolean {
  return Boolean(room) && Number.isSafeInteger(room.id) && [room.x, room.y, room.width, room.height,
    room.door.x, room.door.y, room.standing.x, room.standing.y, room.standing.width, room.standing.height]
    .every(Number.isFinite) && room.width > WALK_RADIUS * 2 && room.height > WALK_RADIUS * 2
}
function finite(value: number, fallback: number): number { return Number.isFinite(value) ? value : fallback }
function freezePoints(points: readonly Point[]): readonly Point[] {
  const result: Point[] = []
  for (const point of points) if (!result.length || !samePoint(result.at(-1)!, point)) result.push(Object.freeze({ ...point }))
  return Object.freeze(result)
}
function hash(left: number, right: number): number {
  let value = (left * 0x45d9f3b) ^ (right * 0x119de1f3)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  return (value ^ (value >>> 16)) >>> 0
}
