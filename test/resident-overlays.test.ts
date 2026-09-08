import assert from 'node:assert/strict'
import test from 'node:test'
import { RESIDENT_BULB_RECTS, RESIDENT_HAND_RECTS, RESIDENT_LOCK_RECTS,
  THING_HEART_RECTS, activityCueRects, residentActivityRects, residentBulbAnchor,
  residentGlyphDistance, thingOverlayAnchor, residentOverlayDistance, residentOverlayRects } from '../src/resident-overlays.ts'
import { cueFrame, emptyCueState, stepActivityCues } from '../src/activity-cues.ts'
import { ROOM_RESIDENT_SIZE } from '../src/room-appearance.ts'

test('resident overlay distances scale from the original 32 pixel figure to the room resident size', () => {
  assert.equal(residentOverlayDistance(-20), -35)
  assert.equal(residentOverlayDistance(12), 21)
})

test('every resident glyph uses the production 32-to-56 overlay scale', () => {
  assert.deepEqual(RESIDENT_LOCK_RECTS[0], { x: 3.5, y: 0, width: 10.5, height: 3.5, color: 0x412f2b, alpha: 1 })
  assert.deepEqual(RESIDENT_BULB_RECTS[0], { x: 10.5, y: 0, width: 10.5, height: 3.5, color: 0xffef83, alpha: 1 })
  assert.deepEqual(THING_HEART_RECTS[0], { x: 0, y: 0, width: 8 / 3, height: 8 / 3, color: 0xd65b70, alpha: 1 })
  assert.deepEqual(RESIDENT_HAND_RECTS[0], { x: -10.5, y: 0, width: 3.5, height: 3.5, color: 0xc78b62, alpha: 1 })
})

test('resident glyph anchors and animated offsets share the production distance helper', () => {
  assert.deepEqual([-58, -47, -20, -18, -9, -5, -4, -3, 1, 13].map(value => residentOverlayDistance(value)),
    [-101.5, -82.25, -35, -31.5, -15.75, -8.75, -7, -5.25, 1.75, 22.75])
})

test('gift heart anchors scale their offset without moving the carried thing', () => {
  const thing = Object.freeze({ x: 100, y: 200 })
  const heart = Object.freeze({ x: 100, y: 188 })
  assert.deepEqual(thingOverlayAnchor(thing, heart), { x: 100, y: 184 })
  assert.deepEqual(thing, { x: 100, y: 200 })
  assert.deepEqual(heart, { x: 100, y: 188 })
})

test('the doubled bulb stays centered and spans the scaled original height above its resident', () => {
  const resident = { x: 200, y: 300 }
  const anchor = residentBulbAnchor(resident)
  assert.equal(anchor.x + Math.min(...RESIDENT_BULB_RECTS.map(cell => cell.x)), resident.x - 15.75)
  assert.equal(anchor.x + Math.max(...RESIDENT_BULB_RECTS.map(cell => cell.x + cell.width)), resident.x + 15.75)
  assert.equal(anchor.y, resident.y - 101.5)
  assert.equal(anchor.y + Math.max(...RESIDENT_BULB_RECTS.map(cell => cell.y + cell.height)), resident.y - 63)
})

test('the handshake shake keeps the original two-pixel cell scale', () => {
  assert.equal(residentGlyphDistance(0), 0)
  assert.equal(residentGlyphDistance(1), 3.5)
})

test('a looking cue sits beside the larger resident head with doubled glyph cells', () => {
  const [frame] = cueFrame(stepActivityCues(emptyCueState(), [{ key: 'look', cue: 'looking',
    startedAt: 0, residentId: 7, thingId: null, roomId: 3 }], 0), 0)
  const rects = residentActivityRects(frame!.cells, 0xffe69a, 0.5)
  assert.equal(Math.min(...rects.map(cell => cell.x)), 31.5)
  assert.equal(Math.min(...rects.map(cell => cell.y)), -38.5)
  assert.equal(Math.max(...rects.map(cell => cell.x + cell.width)), 59.5)
  assert.equal(Math.max(...rects.map(cell => cell.y + cell.height)), -21)
  assert.ok(rects.every(cell => cell.x > ROOM_RESIDENT_SIZE / 2 && cell.width === 3.5 && cell.height === 3.5))
  assert.ok(rects.every(cell => cell.color === 0xffe69a && cell.alpha === 0.5))
})

test('bulb, heart and hands preserve their original double-size glyphs beside larger residents', () => {
  for (const [cells, width, height] of [
    [RESIDENT_BULB_RECTS, 31.5, 38.5],
    [THING_HEART_RECTS, 40 / 3, 32 / 3],
    [RESIDENT_HAND_RECTS, 21, 7],
  ] as const) {
    assert.ok(Math.abs(Math.max(...cells.map(cell => cell.x + cell.width)) - Math.min(...cells.map(cell => cell.x)) - width) < 1e-12)
    assert.ok(Math.abs(Math.max(...cells.map(cell => cell.y + cell.height)) - Math.min(...cells.map(cell => cell.y)) - height) < 1e-12)
  }
})

test('activity cue policy scales with its entity and keeps room cells fixed on screen', () => {
  const cells = [[0, 0], [7, 4]] as const
  assert.deepEqual(activityCueRects(cells, 'thing', 2, 1, 1), [
    { x: 18, y: -22, width: 2, height: 2, color: 1, alpha: 1 },
    { x: 32, y: -14, width: 2, height: 2, color: 1, alpha: 1 },
  ])
  assert.deepEqual(activityCueRects(cells, 'room', 2, 1, 1), [
    { x: 0, y: 0, width: 1, height: 1, color: 1, alpha: 1 },
    { x: 7, y: 4, width: 1, height: 1, color: 1, alpha: 1 },
  ])
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
