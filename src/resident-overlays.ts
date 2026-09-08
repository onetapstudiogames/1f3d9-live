import { ROOM_RESIDENT_SIZE } from './room-appearance.ts'
import { HAND_PIXELS } from './agreements.ts'
import { HEART_PIXELS } from './giving.ts'
import { bulbCells } from './inventions.ts'
import { lockCells } from './laws.ts'

const ORIGINAL_RESIDENT_SIZE = 32

export type ResidentOverlayRect = Readonly<{
  x: number
  y: number
  width: number
  height: number
  color: number
  alpha: number
}>

export function residentOverlayDistance(distance: number, residentSize = ROOM_RESIDENT_SIZE): number {
  return distance * residentSize / ORIGINAL_RESIDENT_SIZE
}

export function residentOverlayAnchor(origin: Readonly<{ x: number; y: number }>,
  anchor: Readonly<{ x: number; y: number }>): Readonly<{ x: number; y: number }> {
  return Object.freeze({ x: origin.x + residentOverlayDistance(anchor.x - origin.x),
    y: origin.y + residentOverlayDistance(anchor.y - origin.y) })
}

export function residentOverlayRects(cells: readonly ResidentOverlayRect[], residentSize = ROOM_RESIDENT_SIZE): readonly ResidentOverlayRect[] {
  return Object.freeze(cells.map(cell => Object.freeze({ ...cell,
    x: residentOverlayDistance(cell.x, residentSize),
    y: residentOverlayDistance(cell.y, residentSize),
    width: residentOverlayDistance(cell.width, residentSize),
    height: residentOverlayDistance(cell.height, residentSize),
  })))
}

function pixelRects(cells: readonly Readonly<{ x: number; y: number }>[], color: number): readonly ResidentOverlayRect[] {
  return residentOverlayRects(cells.map(cell => ({ ...cell, width: 1, height: 1, color, alpha: 1 })))
}

export const RESIDENT_LOCK_RECTS = residentOverlayRects(lockCells().map(cell => ({ ...cell, alpha: 1 })))
export const RESIDENT_BULB_RECTS = residentOverlayRects(bulbCells().map(cell => ({ ...cell, alpha: 1 })))
export const RESIDENT_HEART_RECTS = pixelRects(HEART_PIXELS, 0xd65b70)
export const RESIDENT_HAND_RECTS = pixelRects(HAND_PIXELS, 0xc78b62)
export const RESIDENT_SLEEP_RECTS = residentOverlayRects(
  ([[0, 0], [6, -7], [12, -14]] as const).flatMap(([x, y]) => [
    { x, y, width: 6, height: 2, color: 0xe9dfb9, alpha: 1 },
    { x: x + 2, y: y + 2, width: 2, height: 2, color: 0xe9dfb9, alpha: 1 },
    { x, y: y + 4, width: 6, height: 2, color: 0xe9dfb9, alpha: 1 },
  ]),
)
