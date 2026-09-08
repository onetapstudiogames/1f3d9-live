import type { Point, Room } from './ground/nested.ts'
import { ROOM_RESIDENT_SIZE } from './room-appearance.ts'
import { projectRoomPoint } from './room-view.ts'
import {
  createArrival,
  createDeparture,
  createRoomPath,
  ROOM_WALK_SPEED,
  sampleRoomWalk,
  type MotionRect,
  type RoomWalkPlan,
} from './room-motion.ts'

const DOOR_CORRIDOR_HALF = ROOM_RESIDENT_SIZE / 2 + 4
const TOLERANCE = 0.1

export function resizeRoomWalk(
  plan: RoomWalkPlan,
  elapsedMs: number,
  oldSource: Room | undefined,
  newSource: Room | undefined,
  oldTarget: Room,
  newTarget: Room,
  target: Point,
  sourceObstacles: readonly MotionRect[],
  targetObstacles: readonly MotionRect[],
): RoomWalkPlan | null {
  const sample = sampleRoomWalk(plan, elapsedMs)
  if (sample.done) return buildPlan(null, plan.toId, [], [target])

  if (sample.phase === 'departure') {
    if (!oldSource || !newSource) return null
    const corridor = rebaseDoorCorridor(sample, oldSource, newSource)
    const current = rebaseInside(sample, oldSource, newSource)
    const departure = corridor ? remainingOutsideDeparture(sample, oldSource, newSource, sourceObstacles)
      : current ? createDeparture(newSource, current, sourceObstacles) : null
    if (!departure) return null
    if (!plan.arrival.length) return buildPlan(plan.fromId, plan.toId, departure, [])
    const arrival = createArrival(newTarget, target, targetObstacles)
    if (!arrival) return null
    return buildPlan(plan.fromId, plan.toId, departure, arrival)
  }

  const corridor = rebaseDoorCorridor(sample, oldTarget, newTarget)
  const inside = rebaseInside(sample, oldTarget, newTarget)
  if (!corridor && inside) {
    const arrival = createRoomPath(newTarget, inside, target, targetObstacles)
    return arrival ? buildPlan(null, plan.toId, [], arrival) : null
  }
  if (!corridor) return null
  const fullArrival = createArrival(newTarget, target, targetObstacles)
  if (!fullArrival) return null
  const doorIndex = fullArrival.findIndex(point => samePoint(point, newTarget.door))
  if (doorIndex < 0) return null
  const arrival = freezePoints([corridor.point, ...fullArrival.slice(doorIndex + (corridor.offset < 0 ? 1 : 0))])
  return buildPlan(null, plan.toId, [], arrival)
}

function remainingOutsideDeparture(sample: Point, oldRoom: Room, newRoom: Room,
  obstacles: readonly MotionRect[]): readonly Point[] | null {
  const corridor = rebaseDoorCorridor(sample, oldRoom, newRoom)
  if (!corridor) return null
  const probe = insideDoor(newRoom)
  const complete = createDeparture(newRoom, probe, obstacles)
  const outside = complete?.at(-1)
  if (!outside) return null
  const end = doorOffset(outside, newRoom)
  if (!end || end.offset + TOLERANCE < corridor.offset) return null
  return freezePoints([corridor.point, ...(corridor.offset < 0 ? [newRoom.door] : []), outside])
}

function rebaseInside(point: Point, oldRoom: Room, newRoom: Room): Point | null {
  return projectRoomPoint(point, oldRoom, newRoom)
}

function rebaseDoorCorridor(point: Point, oldRoom: Room, newRoom: Room):
  Readonly<{ point: Point; offset: number }> | null {
  const old = doorOffset(point, oldRoom)
  if (!old || Math.abs(old.lateral) > TOLERANCE) return null
  const normal = outwardNormal(newRoom)
  return Object.freeze({ point: Object.freeze({ x: newRoom.door.x + normal.x * old.offset,
    y: newRoom.door.y + normal.y * old.offset }), offset: old.offset })
}

function doorOffset(point: Point, room: Room): Readonly<{ offset: number; lateral: number }> | null {
  const normal = outwardNormal(room)
  const tangent = { x: -normal.y, y: normal.x }
  const dx = point.x - room.door.x; const dy = point.y - room.door.y
  const offset = dx * normal.x + dy * normal.y
  const lateral = dx * tangent.x + dy * tangent.y
  if (!Number.isFinite(offset) || !Number.isFinite(lateral) || offset < -DOOR_CORRIDOR_HALF - TOLERANCE) return null
  return Object.freeze({ offset, lateral })
}

function outwardNormal(room: Room): Point {
  if (Math.abs(room.door.x - room.x) <= TOLERANCE) return Object.freeze({ x: -1, y: 0 })
  if (Math.abs(room.door.x - (room.x + room.width)) <= TOLERANCE) return Object.freeze({ x: 1, y: 0 })
  if (Math.abs(room.door.y - room.y) <= TOLERANCE) return Object.freeze({ x: 0, y: -1 })
  return Object.freeze({ x: 0, y: 1 })
}

function insideDoor(room: Room): Point {
  const normal = outwardNormal(room)
  return Object.freeze({ x: room.door.x - normal.x * DOOR_CORRIDOR_HALF,
    y: room.door.y - normal.y * DOOR_CORRIDOR_HALF })
}

function buildPlan(fromId: number | null, toId: number, departure: readonly Point[],
  arrival: readonly Point[]): RoomWalkPlan {
  const departureDistance = pathLength(departure); const arrivalDistance = pathLength(arrival)
  const distance = departureDistance + arrivalDistance
  return Object.freeze({ fromId, toId, departure: freezePoints(departure), arrival: freezePoints(arrival),
    departureDistance, arrivalDistance, distance, durationMs: distance / ROOM_WALK_SPEED * 1_000 })
}

function pathLength(path: readonly Point[]): number {
  return path.slice(1).reduce((sum, point, index) => sum +
    Math.hypot(point.x - path[index]!.x, point.y - path[index]!.y), 0)
}

function freezePoints(points: readonly Point[]): readonly Point[] {
  const result: Point[] = []
  for (const point of points) if (!result.length || !samePoint(result.at(-1)!, point)) {
    result.push(Object.freeze({ x: point.x, y: point.y }))
  }
  return Object.freeze(result)
}

function samePoint(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) <= TOLERANCE && Math.abs(left.y - right.y) <= TOLERANCE
}
