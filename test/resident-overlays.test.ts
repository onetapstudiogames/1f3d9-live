import assert from 'node:assert/strict'
import test from 'node:test'
import { residentOverlayDistance, residentOverlayRects } from '../src/resident-overlays.ts'

test('resident overlay distances scale from the original 32 pixel figure to the room resident size', () => {
  assert.equal(residentOverlayDistance(-20), -35)
  assert.equal(residentOverlayDistance(12), 21)
})

test('resident overlay cells scale positions and dimensions together', () => {
  assert.deepEqual(residentOverlayRects([
    { x: -18, y: -28, width: 36, height: 4, color: 0xfff1a8, alpha: 0.18 },
  ]), [
    { x: -31.5, y: -49, width: 63, height: 7, color: 0xfff1a8, alpha: 0.18 },
  ])
})

test('resident overlay scaling can describe another rendered figure size without copied constants', () => {
  assert.deepEqual(residentOverlayRects([
    { x: 8, y: 8, width: 18, height: 13, color: 1, alpha: 1 },
  ], 40), [
    { x: 10, y: 10, width: 22.5, height: 16.25, color: 1, alpha: 1 },
  ])
})
