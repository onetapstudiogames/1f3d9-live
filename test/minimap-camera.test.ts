import assert from 'node:assert/strict'
import test from 'node:test'
import { keepFollowedInView } from '../src/scenes/MinimapView.ts'

test('camera tracking uses current zoom even before Phaser refreshes its world view', () => {
  for (const zoom of [0.2, 0.65, 3]) {
    const camera = {
      width: 375, height: 812, zoom, scrollX: 1000, scrollY: 2000,
      worldView: { x: -5000, y: -9000, width: 20000, height: 30000 },
      centerOn(x: number, y: number) { this.scrollX = x - this.width / 2; this.scrollY = y - this.height / 2 },
    }
    const target = { x: 20000, y: 30000 }
    assert.equal(keepFollowedInView(camera, target, true), true)
    // Project using Phaser's unrotated camera transform, independent of its stale cache.
    const screenX = (target.x - camera.scrollX - camera.width / 2) * zoom + camera.width / 2
    const screenY = (target.y - camera.scrollY - camera.height / 2) * zoom + camera.height / 2
    assert.ok(screenX >= camera.width * 0.375 - 0.00001 && screenX <= camera.width * 0.625 + 0.00001)
    assert.ok(screenY >= camera.height * 0.375 - 0.00001 && screenY <= camera.height * 0.625 + 0.00001)
  }
})

test('a centred figure stays centred when tracking starts at a non-unit zoom', () => {
  const camera = {
    width: 375, height: 812, zoom: 0.65, scrollX: 1000, scrollY: 2000,
    worldView: { x: 0, y: 0, width: 10000, height: 10000 },
    centerOn(x: number, y: number) { this.scrollX = x - this.width / 2; this.scrollY = y - this.height / 2 },
  }
  const target = { x: camera.scrollX + camera.width / 2, y: camera.scrollY + camera.height / 2 }
  assert.equal(keepFollowedInView(camera, target, false), true)
  assert.ok(Math.abs(camera.scrollX - 1000) < 0.00001)
  assert.ok(Math.abs(camera.scrollY - 2000) < 0.00001)
})
