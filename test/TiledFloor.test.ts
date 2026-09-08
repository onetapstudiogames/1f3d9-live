import assert from 'node:assert/strict'
import test from 'node:test'
import type Phaser from 'phaser'
import { TiledFloor } from '../src/scenes/TiledFloor.ts'

test('floor repeats use nearest filtering on the actual tile pattern while text can stay antialiased', () => {
  const pattern = { webGLTexture: {}, magFilter: 9729 }
  let filterCalls = 0
  const sprite = {
    width: 1, height: 1, fillPattern: pattern, context: { imageSmoothingEnabled: true },
    setOrigin() { return this }, setDepth() { return this }, setVisible() { return this },
    setSize(width: number, height: number) { this.width = width; this.height = height; return this },
    updateCanvas() {}, setPosition() { return this }, setDisplaySize() { return this },
    setCrop() { return this }, setTileScale() { return this }, setTilePosition() { return this },
  }
  const scene = { add: { tileSprite: () => sprite, rectangle: () => sprite }, game: { renderer: {
    gl: { NEAREST: 9728 }, setTextureFilter(texture: typeof pattern, filter: number) {
      assert.equal(texture, pattern); assert.equal(filter, 1)
      texture.magFilter = 9728; filterCalls += 1
    },
  } } } as unknown as Phaser.Scene
  const floor = new TiledFloor(scene, 'place-art', { x: 0, y: 0, width: 100, height: 80 }, { x: 0, y: 0 }, 0, .1)
  const camera = { width: 400, height: 320, zoom: 2, scrollX: -100, scrollY: -80 } as Phaser.Cameras.Scene2D.Camera
  floor.update(camera, true)
  assert.equal(pattern.magFilter, 9728)
  assert.equal(sprite.context.imageSmoothingEnabled, false)
  floor.update(camera, true)
  assert.equal(filterCalls, 1)
})
