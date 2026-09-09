import type { NestedLayout, Room } from './ground/nested.ts'
import { roomOutline } from './ground/room-shape.ts'
import { advanceClock, type Clock } from './replay/index.ts'

export type Brick = Readonly<{ x: number; y: number; width: number; height: number; color: number }>
export type PlaceAnimation = Readonly<{
  placeId: number
  kind: 'founding' | 'renaming'
  startedAt: number
  duration: number
  changeId: string
}>
export type PlaceAnimationsByKind = Readonly<{
  founding?: PlaceAnimation
  renaming?: PlaceAnimation
}>

const BRICK = 16
const MORTAR = 1
const DOOR_HALF = 22
const WALL_COLOR = 0x243c30
const WALL_LIGHT = 0x315044

function horizontalCourse(bricks: Brick[], from: number, to: number, y: number, course: number): void {
  for (let x = from + (course ? 8 : 0); x < to; x += BRICK + MORTAR) {
    bricks.push({ x, y, width: Math.min(BRICK, to - x), height: 3,
      color: course ? WALL_LIGHT : WALL_COLOR })
  }
}

function verticalCourse(bricks: Brick[], from: number, to: number, x: number, course: number): void {
  for (let y = from + (course ? 8 : 0); y < to; y += BRICK + MORTAR) {
    bricks.push({ x, y, width: 3, height: Math.min(BRICK, to - y),
      color: course ? WALL_LIGHT : WALL_COLOR })
  }
}

export function wallBricks(room: Room): readonly Brick[] {
  const bricks: Brick[] = []
  const { door } = room
  const horizontal = (from: number, to: number, wallY: number, hasDoor: boolean): void => {
    const spans = hasDoor ? [[from, door.x - DOOR_HALF], [door.x + DOOR_HALF, to]] : [[from, to]]
    for (const [from, to] of spans) for (let course = 0; course < 2; course += 1) {
      horizontalCourse(bricks, from!, to!, wallY - 3 + course * 3, course)
    }
  }
  const vertical = (from: number, to: number, wallX: number, hasDoor: boolean): void => {
    const spans = hasDoor ? [[from, door.y - DOOR_HALF], [door.y + DOOR_HALF, to]] : [[from, to]]
    for (const [from, to] of spans) for (let course = 0; course < 2; course += 1) {
      verticalCourse(bricks, from!, to!, wallX - 3 + course * 3, course)
    }
  }
  for (const [start, end] of roomOutline(room)) {
    if (start.y === end.y) horizontal(Math.min(start.x, end.x), Math.max(start.x, end.x), start.y,
      !room.quiet && door.y === start.y && door.x >= Math.min(start.x, end.x) && door.x <= Math.max(start.x, end.x))
    else vertical(Math.min(start.y, end.y), Math.max(start.y, end.y), start.x,
      !room.quiet && door.x === start.x && door.y >= Math.min(start.y, end.y) && door.y <= Math.max(start.y, end.y))
  }
  return bricks
}

export function placeAnimation(
  kind: PlaceAnimation['kind'], placeId: number, changeId: string, now: number,
): PlaceAnimation {
  const duration = kind === 'founding' ? 3_200 : 700
  return { placeId, kind, changeId, startedAt: Number.isFinite(now) ? now : 0, duration }
}

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

export function animationProgress(animation: PlaceAnimation, now: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(animation.duration) || animation.duration <= 0) return 0
  return unit((now - animation.startedAt) / animation.duration)
}

export function brickCount(total: number, progress: number): number {
  const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  return Math.floor(count * unit(progress))
}

export const signScale = (progress: number): number => unit(progress)

export function stepPlaceAnimations(
  active: readonly PlaceAnimation[], incoming: readonly PlaceAnimation[], now: number,
): readonly PlaceAnimation[] {
  const kept = active.filter(animation => animationProgress(animation, now) < 1)
  const seen = new Set(kept.map(animation => animation.changeId))
  const result = [...kept]
  for (const animation of incoming) if (!seen.has(animation.changeId)) {
    seen.add(animation.changeId)
    const founding = animation.kind === 'renaming'
      ? [...result, ...incoming].find(candidate => candidate.placeId === animation.placeId && candidate.kind === 'founding')
      : undefined
    result.push(founding
      ? { ...animation, startedAt: Math.max(animation.startedAt, founding.startedAt + founding.duration) }
      : animation)
  }
  return result
}

export function placeAnimationsByKind(
  active: readonly PlaceAnimation[],
): ReadonlyMap<number, PlaceAnimationsByKind> {
  const result = new Map<number, PlaceAnimationsByKind>()
  for (const animation of active) {
    const current = result.get(animation.placeId) ?? {}
    result.set(animation.placeId, animation.kind === 'founding'
      ? { ...current, founding: animation }
      : { ...current, renaming: animation })
  }
  return result
}

export function contentHiddenRooms(
  layout: NestedLayout, hidden: ReadonlySet<number>, active: readonly PlaceAnimation[],
): ReadonlySet<number> {
  const result = new Set(hidden)
  const visit = (id: number): void => {
    if (result.has(id)) return
    result.add(id)
    for (const child of layout.rooms[id]?.children ?? []) visit(child)
  }
  for (const animation of active) if (animation.kind === 'founding') visit(animation.placeId)
  return result
}

export function advanceToPlaceMoment(clock: Clock, delta: number, moments: readonly number[]): Clock {
  const advanced = advanceClock(clock, delta)
  if (advanced === clock) return clock
  let next = Number.POSITIVE_INFINITY
  for (const moment of moments) if (Number.isFinite(moment) && clock.time < moment && moment <= advanced.time) {
    next = Math.min(next, moment)
  }
  return Number.isFinite(next) ? { ...advanced, time: next } : advanced
}
