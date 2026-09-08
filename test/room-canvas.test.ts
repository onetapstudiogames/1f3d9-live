import assert from 'node:assert/strict'
import test from 'node:test'
import { roomCanvasSizing } from '../src/room-canvas.ts'
import { ROOM_RESIDENT_SIZE } from '../src/room-appearance.ts'

test('a dense canvas doubles its backing pixels while figures and its CSS box keep their size', () => {
  const frame = roomCanvasSizing(390, 600, 2)
  assert.equal(frame.width, 390)
  assert.equal(frame.height, 600)
  assert.equal(frame.backingWidth, 780)
  assert.equal(frame.backingHeight, 1200)
  assert.equal(ROOM_RESIDENT_SIZE * frame.zoom / 2, ROOM_RESIDENT_SIZE)
})

test('camera compensation keeps the room origin on the canvas at odd sizes and fractional density', () => {
  for (const ratio of [1, 1.25, 2, 3]) {
    const frame = roomCanvasSizing(391, 599, ratio)
    for (const [backing, scroll] of [[frame.backingWidth, frame.scrollX], [frame.backingHeight, frame.scrollY]]) {
      const origin = backing! / 2
      const screenOrigin = Math.round(origin) - origin * frame.zoom - scroll! * frame.zoom
      assert.ok(Math.abs(screenOrigin) < 1e-9)
    }
    assert.equal(frame.backingWidth, Math.round(391 * ratio))
    assert.equal(frame.backingHeight, Math.round(599 * ratio))
  }
})

test('unusable CSS viewports remain unusable while the backing store stays valid', () => {
  const frame = roomCanvasSizing(0, -1, Number.NaN)
  assert.equal(frame.width, 0)
  assert.equal(frame.height, 0)
  assert.equal(frame.backingWidth, 1)
  assert.equal(frame.backingHeight, 1)
  assert.equal(frame.zoom, 1)
})
