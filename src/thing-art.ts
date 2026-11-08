import type { Drawing } from './city/types.ts'
import { drawingCells, type DrawingCell } from './city/drawing.ts'

export function thingDrawingCells(drawing: Drawing | null): readonly DrawingCell[] {
  if (drawing?.drawing) return drawingCells(drawing)
  // One pixel parcel: a dark border, paper wrapping and a vertical string.
  return Array.from({ length: 36 }, (_, index) => {
    const x = 1 + index % 6
    const y = 1 + Math.floor(index / 6)
    return { x, y, color: x === 1 || x === 6 || y === 1 || y === 6 ? 0x805534 : x === 3 ? 0xf4e1a0 : 0xc89d62 }
  })
}

export function thingParticles(kind: 'puff' | 'crumbs', progress: number): readonly Readonly<{
  x: number; y: number; size: number; alpha: number
}>[] {
  if (!Number.isFinite(progress) || progress < 0 || progress >= 1) return []
  return [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1]].map(([dx, dy]) => ({
    x: Math.round(dx! * (8 + progress * 16)),
    y: Math.round(dy! * (6 + progress * 10) + (kind === 'crumbs' ? progress * 14 : -progress * 10)),
    size: kind === 'puff' ? 6 : 3,
    alpha: 1 - progress,
  }))
}

/** The texture key suffix for a thing's remnant art. */
export const REMNANT_TEXTURE_SUFFIX = '-remnant'

/** The texture a thing wears: its own art, or that art faded when it is a remnant. */
export function thingTextureKey(key: string, remnant: boolean): string {
  const base = key.endsWith(REMNANT_TEXTURE_SUFFIX) ? key.slice(0, -REMNANT_TEXTURE_SUFFIX.length) : key
  return remnant ? `${base}${REMNANT_TEXTURE_SUFFIX}` : base
}

// One crack, top right to bottom left, through the 8x8 grid.
const CRACK = new Set(['6,1', '5,2', '5,3', '4,4', '3,5', '3,6'])

/**
 * A remnant keeps its drawing (city decision #172): the same cells, faded to warm stone
 * grey and split by one crack, so it reads as ended without hiding what it was. No cell is
 * added, only a few on the crack are left out.
 */
export function remnantDrawingCells(cells: readonly DrawingCell[]): readonly DrawingCell[] {
  return Object.freeze(cells.filter(cell => !CRACK.has(`${cell.x},${cell.y}`)).map(cell => {
    const luma = 0.299 * (cell.color >> 16 & 0xff) + 0.587 * (cell.color >> 8 & 0xff) + 0.114 * (cell.color & 0xff)
    const grey = Math.round(70 + luma * 0.45)
    const color = (Math.min(255, grey + 8) << 16) | (Math.min(255, grey + 4) << 8) | grey
    return Object.freeze({ x: cell.x, y: cell.y, color })
  }))
}
