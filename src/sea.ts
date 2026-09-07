import type { NestedLayout, Point, Room } from './ground/nested.ts'

export type PixelRect = Readonly<{ x: number; y: number; width: number; height: number; color: number }>
export type BoatFrame = Readonly<{ x: number; y: number; flipX: boolean; bob: number;
  hull: readonly PixelRect[]; sail: readonly PixelRect[]; cells: readonly PixelRect[] }>

const SEA_TILE: readonly PixelRect[] = Object.freeze([
  { x: 8, y: 18, width: 34, height: 3, color: 0x57909a },
  { x: 69, y: 43, width: 42, height: 3, color: 0x477c87 },
  { x: 28, y: 78, width: 48, height: 3, color: 0x69a2a6 },
  { x: 98, y: 109, width: 24, height: 3, color: 0x477c87 },
].map(cell => Object.freeze(cell)))

const BOAT_HULL: readonly PixelRect[] = Object.freeze([
  { x: -14, y: 8, width: 28, height: 5, color: 0x734b32 },
  { x: -10, y: 13, width: 20, height: 3, color: 0x4b3026 },
].map(cell => Object.freeze(cell)))
const BOAT_SAIL: readonly PixelRect[] = Object.freeze([
  { x: -1, y: -12, width: 2, height: 20, color: 0xe8d8a6 },
  { x: 1, y: -10, width: 11, height: 10, color: 0xe8d8a6 },
].map(cell => Object.freeze(cell)))
const BOAT = Object.freeze([...BOAT_HULL, ...BOAT_SAIL])

export const seaTiles = (): readonly PixelRect[] => SEA_TILE

export function islandRim(room: Room): readonly PixelRect[] {
  return Object.freeze([{ x: room.x - 6, y: room.y - 6, width: room.width + 12, height: room.height + 12,
    color: 0xd7bd78 }])
}

function exposedRoot(layout: NestedLayout, point: Point): boolean {
  const root = layout.rooms[layout.rootId]
  if (!root || point.x <= root.x || point.x >= root.x + root.width || point.y <= root.y || point.y >= root.y + root.height) return false
  return root.children.every(id => {
    const room = layout.rooms[id]!
    return point.x < room.x || point.x > room.x + room.width || point.y < room.y || point.y > room.y + room.height
  })
}

export function boatFrame(layout: NestedLayout, path: readonly Point[], progress: number, visible: boolean): BoatFrame | null {
  if (!visible || path.length < 2 || !Number.isFinite(progress) || progress <= 0 || progress >= 1) return null
  const lengths = path.slice(1).map((point, index) => Math.hypot(point.x - path[index]!.x, point.y - path[index]!.y))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  if (total <= 0) return null
  let remaining = total * progress
  let flipX = false
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!
    const from = path[index]!; const to = path[index + 1]!
    if (to.x !== from.x && (remaining > 0 || progress > 0)) flipX = to.x < from.x
    if (remaining <= length || index === lengths.length - 1) {
      const ratio = length ? remaining / length : 1
      const point = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }
      const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
      if (!exposedRoot(layout, midpoint) || !exposedRoot(layout, point)) return null
      return Object.freeze({ ...point, flipX, bob: Math.sin(progress * Math.PI * 4),
        hull: BOAT_HULL, sail: BOAT_SAIL, cells: BOAT })
    }
    remaining -= length
  }
  return null
}
