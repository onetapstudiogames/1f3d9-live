import type { Drawing } from './types.ts'

export type DrawingCell = Readonly<{ x: number; y: number; color: number }>

const DEFAULT_FIGURE = [
  '...00...',
  '..0110..',
  '..0110..',
  '...00...',
  '..0000..',
  '.0.00.0.',
  '...00...',
  '..0..0..',
] as const

function defaultCells(): readonly DrawingCell[] {
  const colors: readonly number[] = [0xf0c95f, 0x5b3b24]
  return DEFAULT_FIGURE.flatMap((row, y) => [...row].flatMap((value, x) => value === '.' ? [] : [{ x, y, color: colors[Number(value)] ?? 0xf0c95f }]))
}

export function drawingCells(drawing: Drawing | null): readonly DrawingCell[] {
  if (!drawing?.drawing) return defaultCells()
  const { palette, indices } = drawing.drawing
  if (indices.length !== 64) throw new Error(`drawing ${drawing.id} must contain exactly 64 cells`)
  const colors = palette.map((color, index) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`drawing ${drawing.id} has invalid palette color ${index}`)
    return Number.parseInt(color.slice(1), 16)
  })
  return indices.flatMap((paletteIndex, offset) => {
    if (paletteIndex === null) return []
    if (!Number.isInteger(paletteIndex) || paletteIndex < 0 || paletteIndex >= colors.length) {
      throw new Error(`drawing ${drawing.id} has invalid palette index at cell ${offset}`)
    }
    return [{ x: offset % 8, y: Math.floor(offset / 8), color: colors[paletteIndex] as number }]
  })
}
