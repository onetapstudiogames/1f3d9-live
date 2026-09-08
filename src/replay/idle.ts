import type { Point } from '../ground/nested.ts'

export const IDLE_WALK_SPEED = 20

export function nextIdleAt(id: number, afterMs: number): number {
  return afterMs + 18_000 + hash(id, Math.floor(afterMs / 1_000)) % 25_000
}

export function idleDestination(id: number, turn: number, origin: Point, standing: Readonly<{ x: number; y: number; width: number; height: number }>, occupied: readonly Point[]): Point | null {
  const margin = 16
  const minX = standing.x + margin
  const maxX = standing.x + standing.width - margin
  const minY = standing.y + margin
  const maxY = standing.y + standing.height - margin
  if (maxX < minX || maxY < minY) return null
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const seed = hash(id + attempt * 97, turn)
    const angle = seed / 0xffffffff * Math.PI * 2
    const distance = 28 + (seed >>> 12) % 29
    const point = Object.freeze({ x: Math.max(minX, Math.min(maxX, origin.x + Math.cos(angle) * distance)),
      y: Math.max(minY, Math.min(maxY, origin.y + Math.sin(angle) * distance)) })
    if (Math.hypot(point.x - origin.x, point.y - origin.y) < 12) continue
    if (idleSegmentClear(origin, point, occupied)) return point
  }
  return null
}

export function idleSegmentClear(from: Point, to: Point, occupied: readonly Point[]): boolean {
  return occupied.every(point => distanceToSegment(point, from, to) >= 48)
}

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy
  const share = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (from.x + dx * share), point.y - (from.y + dy * share))
}

function hash(left: number, right: number): number {
  let value = (left * 0x45d9f3b) ^ (right * 0x119de1f3)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  return (value ^ (value >>> 16)) >>> 0
}
