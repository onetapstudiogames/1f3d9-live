import assert from 'node:assert/strict'
import test from 'node:test'
import { drawingCells } from '../src/city/drawing.ts'
import type { Drawing } from '../src/city/types.ts'

test('drawingCells turns a valid row-major drawing into colored cells', () => {
  const indices = Array<number | null>(64).fill(null)
  indices[0] = 0
  indices[63] = 1
  const drawing = { type: 'resident', id: 1, state: 'complete', drawing: { palette: ['#112233', '#abcdef'], indices } } as Drawing
  assert.deepEqual(drawingCells(drawing), [{ x: 0, y: 0, color: 0x112233 }, { x: 7, y: 7, color: 0xabcdef }])
})

test('drawingCells provides an 8 by 8 pixel figure when no art exists', () => {
  const cells = drawingCells(null)
  assert.ok(cells.length > 0)
  assert.ok(cells.every(cell => cell.x >= 0 && cell.x < 8 && cell.y >= 0 && cell.y < 8))
})

test('drawingCells rejects malformed grids, colors, and palette indices', () => {
  const base = { type: 'resident', id: 1, state: 'complete' } as const
  assert.throws(() => drawingCells({ ...base, drawing: { palette: ['#fff'], indices: [] } }), /64 cells/)
  assert.throws(() => drawingCells({ ...base, drawing: { palette: ['red'], indices: Array(64).fill(null) } }), /palette color/)
  assert.throws(() => drawingCells({ ...base, drawing: { palette: ['#ffffff'], indices: [2, ...Array(63).fill(null)] } }), /palette index/)
})
