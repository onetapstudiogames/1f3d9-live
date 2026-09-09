import { ROOM_RESIDENT_SIZE, ROOM_THING_SIZE } from './room-appearance.ts'
import { HAND_PIXELS } from './agreements.ts'
import { HEART_PIXELS } from './giving.ts'
import { bulbCells } from './inventions.ts'
import { lockCells } from './laws.ts'

const ORIGINAL_RESIDENT_SIZE = 32
const ORIGINAL_THING_SIZE = 24
const ORIGINAL_GLYPH_CELL_SIZE = 2
const ORIGINAL_ACTIVITY_ENTITY_SIZE = 32

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

const FOLLOW_MARK_RECTS = residentOverlayRects([
  { x: -4, y: -22, width: 4, height: 2, color: 0xfff1c7, alpha: 0.82 },
  { x: 0, y: -22, width: 4, height: 2, color: 0xfff1c7, alpha: 0.82 },
  { x: -2, y: -20, width: 4, height: 2, color: 0xfff1c7, alpha: 0.82 },
])

export function followMarkRects(visible: boolean, followed: boolean): readonly ResidentOverlayRect[] {
  return visible && followed ? FOLLOW_MARK_RECTS : Object.freeze([])
}

function scaledRects(cells: readonly ResidentOverlayRect[], scale: (distance: number) => number): readonly ResidentOverlayRect[] {
  return Object.freeze(cells.map(cell => Object.freeze({ ...cell,
    x: scale(cell.x), y: scale(cell.y), width: scale(cell.width), height: scale(cell.height),
  })))
}

function pixelRects(cells: readonly Readonly<{ x: number; y: number }>[], color: number): readonly ResidentOverlayRect[] {
  return scaledRects(cells.map(cell => ({ ...cell, width: 1, height: 1, color, alpha: 1 })), residentGlyphDistance)
}

function thingGlyphDistance(distance: number): number {
  return distance * ROOM_THING_SIZE / ORIGINAL_THING_SIZE
}

function residentActivityRects(cells: readonly (readonly [number, number])[], color: number, alpha: number): readonly ResidentOverlayRect[] {
  return residentOverlayRects(cells.map(([x, y]) => ({
    x: 18 + x * ORIGINAL_GLYPH_CELL_SIZE, y: -22 + y * ORIGINAL_GLYPH_CELL_SIZE,
    width: ORIGINAL_GLYPH_CELL_SIZE, height: ORIGINAL_GLYPH_CELL_SIZE, color, alpha,
  })))
}

export function activityCueRects(cells: readonly (readonly [number, number])[], kind: 'resident' | 'thing' | 'room',
  zoom: number, color: number, alpha: number): readonly ResidentOverlayRect[] {
  if (kind === 'resident') return residentActivityRects(cells, color, alpha)
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const scale = kind === 'thing' ? ROOM_THING_SIZE / ORIGINAL_ACTIVITY_ENTITY_SIZE : 1 / safeZoom
  const originX = kind === 'thing' ? 18 * scale : 0
  const originY = kind === 'thing' ? -22 * scale : 0
  const cellSize = ORIGINAL_GLYPH_CELL_SIZE * scale
  return Object.freeze(cells.map(([x, y]) => Object.freeze({
    x: originX + x * cellSize, y: originY + y * cellSize,
    width: cellSize, height: cellSize, color, alpha,
  })))
}

export const RESIDENT_LOCK_RECTS = residentOverlayRects(lockCells().map(cell => ({ ...cell, alpha: 1 })))
export const RESIDENT_BULB_RECTS = scaledRects(bulbCells().map(cell => ({ ...cell, alpha: 1 })), residentGlyphDistance)
export const THING_HEART_RECTS = scaledRects(
  HEART_PIXELS.map(cell => ({ ...cell, width: 1, height: 1, color: 0xd65b70, alpha: 1 })),
  distance => thingGlyphDistance(distance * ORIGINAL_GLYPH_CELL_SIZE),
)
export const RESIDENT_HAND_RECTS = pixelRects(HAND_PIXELS, 0xc78b62)
