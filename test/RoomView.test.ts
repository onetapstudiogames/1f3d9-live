import assert from 'node:assert/strict'
import test from 'node:test'
import type Phaser from 'phaser'
import type { NestedLayout, Room } from '../src/ground/nested.ts'
import type { PlacePlan } from '../src/places.ts'

test('room name plates refresh texture resolution when device density changes', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const browser = { devicePixelRatio: 1 }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })

  try {
    const { RoomView } = await import('../src/scenes/RoomView.ts')
    let resolutionChanges = 0
    const graphic = {
      setDepth() { return this }, setVisible() { return this }, fillStyle() { return this }, fillRect() { return this },
      lineStyle() { return this }, lineBetween() { return this }, destroy() {},
    }
    const plate = {
      text: 'Room', width: 216, style: { resolution: 1 }, texture: { setFilter() {} },
      setResolution(resolution: number) { this.style.resolution = resolution; resolutionChanges += 1; return this },
      setText(value: string) { this.text = value; return this }, setScale() { return this },
      setFixedSize(width: number) { this.width = width; return this },
    }
    const container = {
      setDepth() { return this }, setScale() { return this }, setVisible() { return this }, destroy() {},
    }
    const tint = {
      setScrollFactor() { return this }, setDepth() { return this }, setPosition() { return this },
      setSize() { return this }, setFillStyle() { return this }, destroy() {},
    }
    const scene = {
      add: {
        rectangle: () => tint,
        graphics: () => Object.create(graphic) as typeof graphic,
        text: () => plate,
        container: () => container,
      },
      events: { once() {}, off() {} },
    } as unknown as Phaser.Scene
    const room: Room = Object.freeze({
      id: 1, parentId: null, name: 'Room', quiet: false, depth: 0, x: 0, y: 0, width: 240, height: 170,
      door: Object.freeze({ x: 240, y: 85 }),
      standing: Object.freeze({ x: 24, y: 24, width: 192, height: 90 }),
      children: Object.freeze([]), notch: null, shelf: null,
    })
    const layout: NestedLayout = Object.freeze({ rooms: Object.freeze({ 1: room }), rootId: 1, width: 240, height: 170 })
    const plan: PlacePlan = Object.freeze({
      foundings: new Map(), renamings: new Map(), historyPlaceIds: [], issues: [], names: new Map(),
      guardedPlaceIds: new Set<number>(), unresolvedFoundings: new Set<number>(), unresolvedRenamings: new Set<number>(),
    })
    const view = new RoomView(scene, layout, plan)
    const camera = { width: 240, height: 170, zoom: 1 } as Phaser.Cameras.Scene2D.Camera

    browser.devicePixelRatio = 2.5
    view.update(camera, 0, 0, new Set(), new Set(), [])
    view.update(camera, 0, 0, new Set(), new Set(), [])

    assert.equal(plate.style.resolution, 2.5)
    assert.equal(resolutionChanges, 1)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete (globalThis as { window?: unknown }).window
  }
})
