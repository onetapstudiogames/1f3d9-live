import { ROOM_RESIDENT_SIZE, ROOM_THING_SIZE } from './room-appearance.ts'
import { HAND_PIXELS } from './agreements.ts'
import { HEART_PIXELS } from './giving.ts'
import { bulbCells } from './inventions.ts'
import { lockCells } from './laws.ts'

const ORIGINAL_RESIDENT_SIZE = 32
const ORIGINAL_THING_SIZE = 24
const ORIGINAL_GLYPH_CELL_SIZE = 2

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

export function thingOverlayAnchor(origin: Readonly<{ x: number; y: number }>,
  anchor: Readonly<{ x: number; y: number }>): Readonly<{ x: number; y: number }> {
  const scale = ROOM_THING_SIZE / ORIGINAL_THING_SIZE
  return Object.freeze({ x: origin.x + (anchor.x - origin.x) * scale,
    y: origin.y + (anchor.y - origin.y) * scale })
}

// Bulbs, hearts and hands were drawn with two-pixel cells beside the old figure.
export function residentGlyphDistance(distance: number): number {
  return residentOverlayDistance(distance * ORIGINAL_GLYPH_CELL_SIZE)
}

export function residentBulbAnchor(origin: Readonly<{ x: number; y: number }>): Readonly<{ x: number; y: number }> {
  return Object.freeze({ x: origin.x + residentOverlayDistance(-9), y: origin.y + residentOverlayDistance(-58) })
}

export function residentOverlayRects(cells: readonly ResidentOverlayRect[], residentSize = ROOM_RESIDENT_SIZE): readonly ResidentOverlayRect[] {
  return scaledRects(cells, distance => residentOverlayDistance(distance, residentSize))
}

function scaledRects(cells: readonly ResidentOverlayRect[], scale: (distance: number) => number): readonly ResidentOverlayRect[] {
  return Object.freeze(cells.map(cell => Object.freeze({ ...cell,
    x: scale(cell.x), y: scale(cell.y), width: scale(cell.width), height: scale(cell.height),
  })))
}

function pixelRects(cells: readonly Readonly<{ x: number; y: number }>[], color: number): readonly ResidentOverlayRect[] {
  return scaledRects(cells.map(cell => ({ ...cell, width: 1, height: 1, color, alpha: 1 })), residentGlyphDistance)
}

export function residentActivityRects(cells: readonly (readonly [number, number])[], color: number, alpha: number): readonly ResidentOverlayRect[] {
  return residentOverlayRects(cells.map(([x, y]) => ({
    x: 18 + x * ORIGINAL_GLYPH_CELL_SIZE, y: -22 + y * ORIGINAL_GLYPH_CELL_SIZE,
    width: ORIGINAL_GLYPH_CELL_SIZE, height: ORIGINAL_GLYPH_CELL_SIZE, color, alpha,
  })))
}

export const RESIDENT_LOCK_RECTS = residentOverlayRects(lockCells().map(cell => ({ ...cell, alpha: 1 })))
export const RESIDENT_BULB_RECTS = scaledRects(bulbCells().map(cell => ({ ...cell, alpha: 1 })), residentGlyphDistance)
export const RESIDENT_HEART_RECTS = pixelRects(HEART_PIXELS, 0xd65b70)
export const RESIDENT_HAND_RECTS = pixelRects(HAND_PIXELS, 0xc78b62)
export const RESIDENT_SLEEP_RECTS = residentOverlayRects(
  ([[0, 0], [6, -7], [12, -14]] as const).flatMap(([x, y]) => [
    { x, y, width: 6, height: 2, color: 0xe9dfb9, alpha: 1 },
    { x: x + 2, y: y + 2, width: 2, height: 2, color: 0xe9dfb9, alpha: 1 },
    { x, y: y + 4, width: 6, height: 2, color: 0xe9dfb9, alpha: 1 },
  ]),
)
