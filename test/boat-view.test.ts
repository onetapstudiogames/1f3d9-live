import assert from 'node:assert/strict'
import test from 'node:test'
import { BoatView } from '../src/scenes/BoatView.ts'
import type { BoatFrame } from '../src/sea.ts'

test('the cached sail sits behind the rider and the hull stays visible in front', () => {
  const made: Array<{ depth: number; visible: boolean; x: number; y: number; scaleX: number; destroyed: boolean }> = []
  const graphics = () => {
    const state = { depth: 0, visible: true, x: 0, y: 0, scaleX: 1, destroyed: false }
    made.push(state)
    return { setDepth(v: number) { state.depth = v; return this }, fillStyle() { return this }, fillRect() { return this },
      setPosition(x: number, y: number) { state.x = x; state.y = y; return this },
      setScale(x: number) { state.scaleX = x; return this }, setVisible(v: boolean) { state.visible = v; return this },
      destroy() { state.destroyed = true } }
  }
  const view = new BoatView({ add: { graphics } } as never)
  const cell = { x: 0, y: 0, width: 2, height: 2, color: 1 }
  const frame: BoatFrame = { x: 12, y: 20, bob: 1, flipX: true, hull: [cell], sail: [cell], cells: [cell, cell] }
  view.update(frame)
  assert.deepEqual(made.map(row => row.depth), [99, 100.5])
  assert.ok(made.every(row => row.x === 12 && row.y === 21 && row.scaleX === -1))
  view.update(null)
  assert.ok(made.every(row => !row.visible))
  view.destroy()
  assert.ok(made.every(row => row.destroyed))
})
