import assert from 'node:assert/strict'
import test from 'node:test'
import type { NestedLayout, Room } from '../src/ground/nested.ts'
import { boatFrame, islandRim, seaTiles, seaViewport } from '../src/sea.ts'

const room = (id: number, parentId: number | null, x: number, y: number, width: number, height: number): Room =>
  ({ id, parentId, name: String(id), quiet: false, depth: parentId === null ? 0 : 1, x, y, width, height,
    door: { x, y: y + height / 2 }, standing: { x: x + 10, y: y + 10, width: width - 20, height: 20 }, children: [] })
const root = { ...room(1, null, 0, 0, 300, 180), children: [2, 3] }
const left = room(2, 1, 20, 30, 70, 100); const right = room(3, 1, 210, 30, 70, 100)
const layout: NestedLayout = { rootId: 1, width: 300, height: 180, rooms: { 1: root, 2: left, 3: right } }

test('sea and sand are bounded immutable pixel rectangles', () => {
  assert.ok(seaTiles().length > 3)
  assert.ok(seaTiles().every(cell => Number.isInteger(cell.x) && Number.isInteger(cell.y) && cell.width > 0))
  assert.deepEqual(islandRim(left), [{ x: 14, y: 24, width: 82, height: 112, color: 0xd7bd78 }])
})

test('sea viewport clips to the root and never allocates beyond the camera', () => {
  const middle = seaViewport(root, { scrollX: 150, scrollY: 90, width: 200, height: 100, zoom: 2 })!
  assert.deepEqual({ x: middle.x, y: middle.y, width: middle.width, height: middle.height },
    { x: 200, y: 115, width: 100, height: 50 })
  assert.deepEqual({ width: middle.pixelWidth, height: middle.pixelHeight }, { width: 200, height: 100 })
  assert.equal(middle.tileScaleX, middle.pixelWidth / middle.width)
  assert.deepEqual({ x: middle.cropX, y: middle.cropY, width: middle.cropWidth, height: middle.cropHeight },
    { x: 0, y: 0, width: 192, height: 100 })
  const edge = seaViewport(root, { scrollX: -40, scrollY: -20, width: 200, height: 100, zoom: 1 })!
  assert.deepEqual({ x: edge.x, y: edge.y, width: edge.width, height: edge.height },
    { x: -40, y: -20, width: 200, height: 100 })
  assert.deepEqual({ x: edge.cropX, y: edge.cropY, width: edge.cropWidth, height: edge.cropHeight },
    { x: 44, y: 24, width: 156, height: 76 })
  assert.equal(seaViewport(root, { scrollX: -500, scrollY: -500, width: 100, height: 100, zoom: 1 }), null)
})

test('sea pattern remains anchored while panning and zooming', () => {
  const first = seaViewport(root, { scrollX: 150, scrollY: 90, width: 100, height: 80, zoom: 1 })!
  const panned = seaViewport(root, { scrollX: 278, scrollY: 90, width: 100, height: 80, zoom: 1 })!
  assert.equal(first.tileX, panned.tileX)
  const zoomed = seaViewport(root, { scrollX: 150, scrollY: 90, width: 100, height: 80, zoom: 0.5 })!
  assert.deepEqual([zoomed.pixelWidth, zoomed.pixelHeight], [first.pixelWidth, first.pixelHeight])
  assert.equal(zoomed.tileScaleX, 0.5)
})

test('a cross-island route boats only on its exposed root-floor segment', () => {
  const path = [{ x: 40, y: 80 }, { x: 90, y: 80 }, { x: 210, y: 80 }, { x: 250, y: 80 }]
  assert.equal(boatFrame(layout, path, 0.1, true), null)
  assert.equal(boatFrame(layout, path, 0.5, true)?.x, 145)
  assert.equal(boatFrame(layout, path, 0.9, true), null)
})

test('same-island, hidden, idle, and exact-coast samples never show boats', () => {
  const inland = [{ x: 30, y: 60 }, { x: 80, y: 60 }]
  assert.equal(boatFrame(layout, inland, 0.5, true), null)
  assert.equal(boatFrame(layout, [{ x: 90, y: 80 }, { x: 210, y: 80 }], 0, true), null)
  assert.equal(boatFrame(layout, [{ x: 90, y: 80 }, { x: 210, y: 80 }], 0.5, false), null)
  assert.equal(boatFrame(layout, [], 0.5, true), null)
  assert.equal(boatFrame(layout, [{ x: 100, y: 80 }, { x: 200, y: 80 }], Number.NaN, true), null)
  assert.equal(boatFrame({ ...layout, rootId: 99 }, [{ x: 100, y: 80 }, { x: 200, y: 80 }], 0.5, true), null)
  assert.equal(boatFrame(layout, [{ x: -20, y: 10 }, { x: -10, y: 10 }], 0.5, true), null)
})
