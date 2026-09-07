import assert from 'node:assert/strict'
import test from 'node:test'
import { followScroll, minimapFrame, minimapPlan, minimapWorldPoint } from '../src/minimap.ts'
import type { NestedLayout, Room } from '../src/ground/nested.ts'

const room = (id: number, parentId: number | null, x: number, y: number, width: number, height: number,
  quiet = false): Room => ({ id, parentId, x, y, width, height, quiet, name: `room ${id}`, depth: parentId === null ? 0 : 1,
    door: { x, y }, standing: { x, y, width, height }, children: [] })

test('static outlines keep a quiet room but omit its contents and all future founding subtrees', () => {
  const rooms = { 1: { ...room(1, null, 0, 0, 1000, 500), children: [2, 4] },
    2: { ...room(2, 1, 50, 50, 200, 150, true), children: [3] }, 3: room(3, 2, 70, 70, 50, 50),
    4: { ...room(4, 1, 400, 50, 200, 150), children: [5] }, 5: room(5, 4, 420, 70, 50, 50) }
  const plan = minimapPlan({ rooms, rootId: 1, width: 1000, height: 500 }, new Set([4]))
  assert.deepEqual(plan.staticRooms.map(row => row.id), [1, 2])
  assert.deepEqual(plan.dynamicRooms.map(row => row.id), [4, 5])
})

test('frame reveals founded outlines only when the recorded visibility says so', () => {
  const layout: NestedLayout = { rooms: { 1: { ...room(1, null, 0, 0, 100, 100), children: [2] }, 2: room(2, 1, 20, 20, 30, 30) }, rootId: 1, width: 100, height: 100 }
  const plan = minimapPlan(layout, new Set([2]), 100, 100)
  assert.deepEqual(minimapFrame(plan, { x: 10, y: 20, width: 30, height: 40 }, { x: 25, y: 35 }, new Set([2])),
    { dynamicRooms: [], viewport: { x: 10, y: 20, width: 30, height: 40 }, followed: { x: 25, y: 35 } })
  assert.deepEqual(minimapFrame(plan, { x: 10, y: 20, width: 30, height: 40 }, null, new Set()).dynamicRooms.map(row => row.id), [2])
})

test('minimap clicks map back to bounded world coordinates', () => {
  const plan = minimapPlan({ rooms: { 1: room(1, null, 0, 0, 1000, 500) }, rootId: 1, width: 1000, height: 500 })
  assert.deepEqual(minimapWorldPoint(plan, 80, 40), { x: 500, y: 250 })
  assert.deepEqual(minimapWorldPoint(plan, -5, 999), { x: 0, y: 500 })
})

test('viewport rectangle clips at both map edges', () => {
  const plan = minimapPlan({ rooms: { 1: room(1, null, 0, 0, 100, 100) }, rootId: 1, width: 100, height: 100 }, new Set(), 100, 100)
  assert.deepEqual(minimapFrame(plan, { x: -10, y: 90, width: 30, height: 30 }, null, new Set()).viewport,
    { x: 0, y: 90, width: 20, height: 10 })
})

test('follow glides until acquired then keeps the target inside a safe inset', () => {
  assert.deepEqual(followScroll({ x: 0, y: 0 }, { x: 900, y: 400 }, { width: 400, height: 200 }, false), { x: 84, y: 36, acquired: false })
  const kept = followScroll({ x: 0, y: 0 }, { x: 390, y: 190 }, { width: 400, height: 200 }, true)
  assert.equal(kept.acquired, true)
  assert.ok(kept.x >= 130 && kept.y >= 65)
})
