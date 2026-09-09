import assert from 'node:assert/strict'
import test from 'node:test'
import { roomCanvasSizing } from '../src/room-canvas.ts'
import { roomTextResolution } from '../src/room-appearance.ts'

test('room rendering and readable labels use device density without changing CSS size', () => {
  const normal = roomCanvasSizing(375, 600, 1)
  const dense = roomCanvasSizing(375, 600, 2.5)
  assert.equal(roomTextResolution(2.5), 2.5)
  assert.equal(dense.width, normal.width)
  assert.equal(dense.height, normal.height)
  assert.equal(dense.backingWidth, Math.round(normal.width * 2.5))
  assert.equal(dense.backingHeight, normal.height * 2.5)
})
