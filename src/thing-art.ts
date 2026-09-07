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
