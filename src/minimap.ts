import type { NestedLayout, Point, Room } from './ground/nested.ts'
import { roomOutline } from './ground/room-shape.ts'

export type MiniRect = Readonly<{ id: number; x: number; y: number; width: number; height: number; outline?: readonly Point[] }>
export type MinimapPlan = Readonly<{
  width: number; height: number; worldWidth: number; worldHeight: number
  staticRooms: readonly MiniRect[]; dynamicRooms: readonly MiniRect[]
}>
export type MinimapFrame = Readonly<{
  dynamicRooms: readonly MiniRect[]
  viewport: Readonly<{ x: number; y: number; width: number; height: number }>
  followed: Point | null
}>

export function minimapPlan(layout: NestedLayout, foundingIds: ReadonlySet<number> = new Set(),
  maximumWidth = 160, maximumHeight = 100): MinimapPlan {
  const scale = Math.min(maximumWidth / layout.width, maximumHeight / layout.height)
  const width = Math.max(1, Math.round(layout.width * scale)); const height = Math.max(1, Math.round(layout.height * scale))
  const rooms = Object.values(layout.rooms).sort((left, right) => left.depth - right.depth || left.id - right.id)
    .filter(room => drawableRoom(room, layout.rooms))
  const dynamic = rooms.filter(room => hasAncestor(room, layout.rooms, id => foundingIds.has(id)))
  return Object.freeze({ width, height, worldWidth: layout.width, worldHeight: layout.height,
    staticRooms: Object.freeze(rooms.filter(room => !dynamic.includes(room)).map(room => miniRect(room, width / layout.width, height / layout.height))),
    dynamicRooms: Object.freeze(dynamic.map(room => miniRect(room, width / layout.width, height / layout.height))) })
}

export function minimapFrame(plan: MinimapPlan, view: Readonly<{ x: number; y: number; width: number; height: number }>,
  followed: Point | null, hiddenIds: ReadonlySet<number>): MinimapFrame {
  const xScale = plan.width / plan.worldWidth; const yScale = plan.height / plan.worldHeight
  const left = clamp(view.x * xScale, 0, plan.width); const top = clamp(view.y * yScale, 0, plan.height)
  const right = clamp((view.x + view.width) * xScale, 0, plan.width)
  const bottom = clamp((view.y + view.height) * yScale, 0, plan.height)
  return Object.freeze({
    dynamicRooms: Object.freeze(plan.dynamicRooms.filter(room => !hiddenIds.has(room.id))),
    viewport: Object.freeze({ x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }),
    followed: followed && Object.freeze({ x: clamp(followed.x * xScale, 0, plan.width), y: clamp(followed.y * yScale, 0, plan.height) }),
  })
}

export function minimapWorldPoint(plan: MinimapPlan, x: number, y: number): Point {
  return Object.freeze({ x: clamp(x, 0, plan.width) / plan.width * plan.worldWidth,
    y: clamp(y, 0, plan.height) / plan.height * plan.worldHeight })
}

export function followScroll(current: Point, target: Point, view: Readonly<{ width: number; height: number }>, acquired: boolean): Readonly<Point & { acquired: boolean }> {
  const desired = { x: target.x - view.width / 2, y: target.y - view.height / 2 }
  let x = current.x + (desired.x - current.x) * 0.12; let y = current.y + (desired.y - current.y) * 0.12
  const insetX = view.width * 0.375; const insetY = view.height * 0.375
  const inside = target.x >= current.x + insetX && target.x <= current.x + view.width - insetX
    && target.y >= current.y + insetY && target.y <= current.y + view.height - insetY
  const ready = acquired || inside
  if (ready) {
    x = clamp(x, target.x - (view.width - insetX), target.x - insetX)
    y = clamp(y, target.y - (view.height - insetY), target.y - insetY)
  }
  return Object.freeze({ x, y, acquired: ready })
}

function drawableRoom(room: Room, rooms: NestedLayout['rooms']): boolean {
  return !hasAncestor(room, rooms, id => id !== room.id && rooms[id]?.quiet === true)
}
function hasAncestor(room: Room, rooms: NestedLayout['rooms'], predicate: (id: number) => boolean): boolean {
  let current: Room | undefined = room
  while (current) { if (predicate(current.id)) return true; current = current.parentId === null ? undefined : rooms[current.parentId] }
  return false
}
function miniRect(room: Room, xScale: number, yScale: number): MiniRect {
  const base: MiniRect = { id: room.id, x: Math.round(room.x * xScale), y: Math.round(room.y * yScale),
    width: Math.max(1, Math.round(room.width * xScale)), height: Math.max(1, Math.round(room.height * yScale)) }
  if (!room.notch) return Object.freeze(base)
  return Object.freeze({ ...base, outline: Object.freeze(roomOutline(room).map(([point]) => Object.freeze({
    x: Math.round(point.x * xScale), y: Math.round(point.y * yScale),
  }))) })
}
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
}
