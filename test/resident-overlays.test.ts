import assert from 'node:assert/strict'
import test from 'node:test'
import { RESIDENT_BULB_RECTS, RESIDENT_HAND_RECTS, RESIDENT_HEART_RECTS, RESIDENT_LOCK_RECTS,
  RESIDENT_SLEEP_RECTS, residentOverlayAnchor, residentOverlayDistance, residentOverlayRects } from '../src/resident-overlays.ts'

test('resident overlay distances scale from the original 32 pixel figure to the room resident size', () => {
  assert.equal(residentOverlayDistance(-20), -35)
  assert.equal(residentOverlayDistance(12), 21)
})

test('every resident glyph uses the production 32-to-56 overlay scale', () => {
  assert.deepEqual(RESIDENT_LOCK_RECTS[0], { x: 3.5, y: 0, width: 10.5, height: 3.5, color: 0x412f2b, alpha: 1 })
  assert.deepEqual(RESIDENT_BULB_RECTS[0], { x: 5.25, y: 0, width: 5.25, height: 1.75, color: 0xffef83, alpha: 1 })
  assert.deepEqual(RESIDENT_HEART_RECTS[0], { x: 0, y: 0, width: 1.75, height: 1.75, color: 0xd65b70, alpha: 1 })
  assert.deepEqual(RESIDENT_HAND_RECTS[0], { x: -5.25, y: 0, width: 1.75, height: 1.75, color: 0xc78b62, alpha: 1 })
  assert.deepEqual(RESIDENT_SLEEP_RECTS[0], { x: 0, y: 0, width: 10.5, height: 3.5, color: 0xe9dfb9, alpha: 1 })
})

test('resident glyph anchors and animated offsets share the production distance helper', () => {
  assert.deepEqual([-58, -47, -20, -18, -9, -5, -4, -3, 1, 13].map(value => residentOverlayDistance(value)),
    [-101.5, -82.25, -35, -31.5, -15.75, -8.75, -7, -5.25, 1.75, 22.75])
})

test('gift heart anchors scale their offset without moving the carried thing', () => {
  const thing = Object.freeze({ x: 100, y: 200 })
  const heart = Object.freeze({ x: 100, y: 188 })
  assert.deepEqual(residentOverlayAnchor(thing, heart), { x: 100, y: 179 })
  assert.deepEqual(thing, { x: 100, y: 200 })
  assert.deepEqual(heart, { x: 100, y: 188 })
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
