import { test } from 'node:test'
import assert from 'node:assert/strict'
import { floorViewport } from '../src/floor-viewport.ts'

test('a world portrait never needs a world-sized image, even while browsing and zooming', () => {
  const room = { x: 4, y: 4, width: 40000, height: 60000 }
  for (const zoom of [0.005, 0.03, 0.65, 1, 3]) {
    for (let pan = 0; pan < 1000; pan += 19) {
      const view = floorViewport(room, { scrollX: pan, scrollY: pan, width: 375, height: 812, zoom })
      assert.ok(view)
      assert.ok(view.pixelWidth <= 375 && view.pixelHeight <= 812)
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
