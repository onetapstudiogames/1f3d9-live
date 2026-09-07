import type { NestedLayout, Point, Room } from './ground/nested.ts'

export type PixelRect = Readonly<{ x: number; y: number; width: number; height: number; color: number }>
export type BoatFrame = Readonly<{ x: number; y: number; flipX: boolean; bob: number;
  hull: readonly PixelRect[]; sail: readonly PixelRect[]; cells: readonly PixelRect[] }>
export type SeaCamera = Readonly<{ scrollX: number; scrollY: number; width: number; height: number; zoom: number }>
export type SeaViewport = Readonly<{ x: number; y: number; width: number; height: number; pixelWidth: number;
  pixelHeight: number; tileScaleX: number; tileScaleY: number; tileX: number; tileY: number;
  cropX: number; cropY: number; cropWidth: number; cropHeight: number }>

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

export function seaViewport(root: Room, camera: SeaCamera): SeaViewport | null {
  if (![root.x, root.y, root.width, root.height, camera.scrollX, camera.scrollY, camera.width,
    camera.height, camera.zoom].every(Number.isFinite) || camera.zoom <= 0 || camera.width <= 0 || camera.height <= 0) return null
  const viewWidth = camera.width / camera.zoom; const viewHeight = camera.height / camera.zoom
  const viewX = camera.scrollX + camera.width / 2 - viewWidth / 2
  const viewY = camera.scrollY + camera.height / 2 - viewHeight / 2
  const floorX = root.x + 4; const floorY = root.y + 4
  const left = Math.max(floorX, viewX); const top = Math.max(floorY, viewY)
  const right = Math.min(root.x + root.width - 4, viewX + viewWidth)
  const bottom = Math.min(root.y + root.height - 4, viewY + viewHeight)
  if (right <= left || bottom <= top) return null
  const pixelWidth = Math.max(1, Math.ceil(camera.width)); const pixelHeight = Math.max(1, Math.ceil(camera.height))
  const tileScaleX = pixelWidth / viewWidth; const tileScaleY = pixelHeight / viewHeight
  const cropX = Math.max(0, (left - viewX) * tileScaleX); const cropY = Math.max(0, (top - viewY) * tileScaleY)
  const cropWidth = Math.min(pixelWidth - cropX, (right - left) * tileScaleX)
  const cropHeight = Math.min(pixelHeight - cropY, (bottom - top) * tileScaleY)
  const modulo = (value: number): number => ((value % 128) + 128) % 128
  return Object.freeze({ x: viewX, y: viewY, width: viewWidth, height: viewHeight, pixelWidth, pixelHeight,
    tileScaleX, tileScaleY, tileX: modulo(viewX - floorX), tileY: modulo(viewY - floorY),
    cropX, cropY, cropWidth, cropHeight })
}

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
