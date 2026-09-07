import type { Point, Room } from './nested.ts'

export type FloorRect = Readonly<{ x: number; y: number; width: number; height: number }>
export type OutlineSegment = readonly [Point, Point]

export function roomFloorRects(room: Room, inset = 0): readonly FloorRect[] {
  const safe = Number.isFinite(inset) ? Math.max(0, inset) : 0
  const width = room.width - safe * 2; const height = room.height - safe * 2
  if (width <= 0 || height <= 0) return Object.freeze([])
  if (!room.notch) return Object.freeze([Object.freeze({ x: room.x + safe, y: room.y + safe, width, height })])
  const stepY = room.y + room.height - room.notch.height - safe
  const stepX = room.x + room.width - room.notch.width - safe
  const upper = { x: room.x + safe, y: room.y + safe, width, height: stepY - (room.y + safe) }
  const lower = { x: room.x + safe, y: stepY, width: stepX - (room.x + safe), height: room.y + room.height - safe - stepY }
  return Object.freeze([upper, lower].filter(rect => rect.width > 0 && rect.height > 0)
    .map(rect => Object.freeze(rect) as FloorRect))
}

export function roomContains(room: Room, point: Point, inset = 0): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false
  return roomFloorRects(room, inset).some(rect => point.x >= rect.x && point.x <= rect.x + rect.width
    && point.y >= rect.y && point.y <= rect.y + rect.height)
}

export function roomOutline(room: Room): readonly OutlineSegment[] {
  const { x, y, width, height } = room
  const points: Point[] = room.notch ? [
    { x, y }, { x: x + width, y }, { x: x + width, y: y + height - room.notch.height },
    { x: x + width - room.notch.width, y: y + height - room.notch.height },
    { x: x + width - room.notch.width, y: y + height }, { x, y: y + height },
  ] : [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
  return Object.freeze(points.map((point, index) => Object.freeze([
    Object.freeze(point), Object.freeze(points[(index + 1) % points.length]!),
  ] as const)))
}
