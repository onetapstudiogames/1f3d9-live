import { test } from 'node:test'
import assert from 'node:assert/strict'
import { floorViewport } from '../src/floor-viewport.ts'
import { roomCanvasSizing } from '../src/room-canvas.ts'

test('room floor textures fit the canvas at each device density', () => {
  for (const density of [1, 1.25, 2, 3]) {
    for (const width of [375, 1280]) {
      const frame = roomCanvasSizing(width, 600, density)
      const room = { x: 16, y: 16, width: width - 32, height: 568 }
      const view = floorViewport(room, { ...frame, width: frame.backingWidth, height: frame.backingHeight })
      assert.ok(view)
      assert.ok(view.pixelWidth <= frame.backingWidth && view.pixelHeight <= frame.backingHeight)
      assert.equal(view.scale, density)
      assert.equal(view.x, room.x)
      assert.equal(view.y, room.y)
      assert.ok(view.cropWidth > 0 && view.cropHeight > 0)
      assert.ok(view.cropX >= 0 && view.cropY >= 0)
      assert.ok(view.cropX + view.cropWidth <= view.pixelWidth + 0.001)
    }
  }
})

test('small floors allocate their own size and offscreen floors draw nothing', () => {
  const room = { x: 0, y: 0, width: 100, height: 80 }
  assert.equal(floorViewport(room, { scrollX: 500, scrollY: 500, width: 375, height: 812, zoom: 1 }), null)
  const result = floorViewport(room, { scrollX: 0, scrollY: 0, width: 375, height: 812, zoom: 1 })!
  assert.equal(result.pixelWidth, 100); assert.equal(result.pixelHeight, 80)
  assert.equal(result.tileX, 4); assert.equal(result.tileY, 4)
  assert.equal(floorViewport(room, { scrollX: 0, scrollY: 0, width: 0, height: 0, zoom: 1 }), null)
})

test('a real camera can carry nonnumeric engine fields without hiding every portrait', () => {
  const camera = { scrollX: 0, scrollY: 0, width: 375, height: 812, zoom: 1, scene: {}, visible: true }
  assert.ok(floorViewport({ x: 0, y: 0, width: 400, height: 900 }, camera))
})
