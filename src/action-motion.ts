import type { Point, Room } from './ground/nested.ts'
import { ROOM_RESIDENT_SIZE } from './room-appearance.ts'
import { ROOM_FIGURE_PITCH, ROOM_THING_PITCH } from './room-crowding.ts'
import { createRoomPath, ROOM_WALK_SPEED, type MotionRect } from './room-motion.ts'

export const ACTION_WALK_SPEED = ROOM_WALK_SPEED
export const ACTION_SHAKE_MS = 1_000
const BESIDE_DISTANCE = ROOM_FIGURE_PITCH / 2 + ROOM_THING_PITCH / 2 + 2
const SHAKE_DISTANCE = 3

export type ActionMotionPlan = Readonly<{
  path: readonly Point[]
  target: Point
  distance: number
  walkDurationMs: number
  durationMs: number
}>

export type ActionMotionSample = Readonly<Point & {
  phase: 'approach' | 'shake' | 'done'
  offsetX: number
  travelled: number
  done: boolean
  flipX: boolean
}>

export function createActionMotion(room: Room, origin: Point, thing: Point,
  obstacles: readonly MotionRect[]): ActionMotionPlan | null {
  const half = ROOM_RESIDENT_SIZE / 2
  const minX = room.standing.x + half; const maxX = room.standing.x + room.standing.width - half
  const minY = room.standing.y + half; const maxY = room.standing.y + room.standing.height - half
  const clampX = (x: number): number => Math.max(minX, Math.min(maxX, x))
  const clampY = (y: number): number => Math.max(minY, Math.min(maxY, y))
  const candidates = [
    { x: thing.x - BESIDE_DISTANCE, y: clampY(thing.y) }, { x: thing.x + BESIDE_DISTANCE, y: clampY(thing.y) },
    { x: clampX(thing.x), y: thing.y - BESIDE_DISTANCE }, { x: clampX(thing.x), y: thing.y + BESIDE_DISTANCE },
    ...[-BESIDE_DISTANCE, BESIDE_DISTANCE].flatMap(dx => [-BESIDE_DISTANCE, BESIDE_DISTANCE]
      .map(dy => ({ x: thing.x + dx, y: thing.y + dy }))),
  ].filter(point => point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY)
    .sort((a, b) => Math.hypot(a.x - thing.x, a.y - thing.y) - Math.hypot(b.x - thing.x, b.y - thing.y)
      || Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y))
  for (const target of candidates) {
    const path = createRoomPath(room, origin, target, obstacles)
    if (!path) continue
    const distance = path.slice(1).reduce((sum, point, index) => sum + Math.hypot(
      point.x - path[index]!.x, point.y - path[index]!.y), 0)
    const walkDurationMs = distance / ACTION_WALK_SPEED * 1_000
    return Object.freeze({ path, target: Object.freeze(target), distance, walkDurationMs,
      durationMs: walkDurationMs + ACTION_SHAKE_MS })
  }
  return null
}

export function sampleActionMotion(plan: ActionMotionPlan, elapsedMs: number): ActionMotionSample {
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0)
  if (elapsed >= plan.durationMs) return Object.freeze({ ...plan.target, phase: 'done', offsetX: 0,
    travelled: plan.distance, done: true, flipX: false })
  if (elapsed >= plan.walkDurationMs) {
    const shakeElapsed = elapsed - plan.walkDurationMs
    const offsetX = Math.sin(shakeElapsed / 125 * Math.PI) * SHAKE_DISTANCE
    return Object.freeze({ ...plan.target, phase: 'shake', offsetX, travelled: plan.distance,
      done: false, flipX: false })
  }
  const travelled = Math.min(plan.distance, elapsed / 1_000 * ACTION_WALK_SPEED)
  const point = samplePath(plan.path, travelled)
  return Object.freeze({ ...point, phase: 'approach', offsetX: 0, travelled, done: false,
    flipX: point.flipX })
}

function samplePath(path: readonly Point[], distance: number): Point & { flipX: boolean } {
  if (!path.length) return { x: 0, y: 0, flipX: false }
  let remaining = distance
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]!; const to = path[index]!
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (remaining <= length) {
      const share = length ? remaining / length : 1
      return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share,
        flipX: to.x < from.x }
    }
    remaining -= length
  }
  const last = path.at(-1)!
  const before = path.at(-2) ?? last
  return { ...last, flipX: last.x < before.x }
}
