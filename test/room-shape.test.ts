import assert from 'node:assert/strict'
import test from 'node:test'
import { nestedLayout, type Place, type Room } from '../src/ground/nested.ts'
import { roomContains, roomFloorRects, roomOutline } from '../src/ground/room-shape.ts'
import { curtainCells } from '../src/room-art.ts'
import { readFileSync } from 'node:fs'

test('stepped rooms are a bounded L with doors and standing floor outside the notch', () => {
  const places: Place[] = [{ id: 1, parent_id: null }, ...Array.from({ length: 12 }, (_, index) => ({ id: index + 2, parent_id: 1 }))]
  const layout = nestedLayout(places)
  const shaped = Object.values(layout.rooms).find(room => room.notch)!
  assert.ok(shaped)
  assert.ok(shaped.notch!.width <= shaped.width / 3 && shaped.notch!.height <= shaped.height / 3)
  assert.equal(roomFloorRects(shaped).length, 2)
  assert.equal(roomOutline(shaped).length, 6)
  assert.equal(roomContains(shaped, shaped.door), true)
  for (const corner of [
    { x: shaped.standing.x, y: shaped.standing.y },
    { x: shaped.standing.x + shaped.standing.width, y: shaped.standing.y + shaped.standing.height },
  ]) assert.equal(roomContains(shaped, corner), true)
  assert.equal(roomContains(shaped, { x: shaped.x + shaped.width - 2, y: shaped.y + shaped.height - 2 }), false)
  for (const parent of Object.values(layout.rooms)) for (const id of parent.children) {
    const child = layout.rooms[id]!
    for (const point of [{ x: child.x, y: child.y }, { x: child.x + child.width, y: child.y + child.height }]) {
      assert.equal(roomContains(parent, point), true, `room ${id} must stay on the shaped floor of ${parent.id}`)
    }
  }
})

test('room shape helpers preserve rectangles and inset each exposed wall', () => {
  const room: Room = { id: 1, parentId: null, name: 'room', quiet: false, depth: 0, x: 10, y: 20,
    width: 100, height: 80, door: { x: 10, y: 60 }, standing: { x: 20, y: 30, width: 60, height: 20 },
    children: [], notch: { width: 24, height: 20 }, shelf: null }
  assert.deepEqual(roomFloorRects(room, 4), [
    { x: 14, y: 24, width: 92, height: 52 }, { x: 14, y: 76, width: 68, height: 20 },
  ])
  assert.equal(roomContains(room, { x: 84, y: 78 }, 4), false)
  assert.equal(roomContains(room, { x: 80, y: 90 }, 4), true)
})

test('layout has deterministic wide, tall, compact, and staggered shelf variants', () => {
  const places: Place[] = [{ id: 1, parent_id: null }, ...Array.from({ length: 30 }, (_, index) => ({ id: index + 2, parent_id: 1 }))]
  const first = nestedLayout(places)
  assert.deepEqual(nestedLayout([...places].reverse()), first)
  const children = first.rooms[1]!.children.map(id => first.rooms[id]!)
  assert.ok(new Set(children.map(room => Math.round(room.width / room.height * 10))).size >= 3)
  const shelves = new Map<number, Room[]>()
  for (const child of children) shelves.set(child.shelf!.row, [...(shelves.get(child.shelf!.row) ?? []), child])
  assert.ok(shelves.size > 1)
  assert.ok([...shelves].some(([row, rooms]) => row % 2 === 1 && Math.min(...rooms.map(room => room.x)) > 48))
})

test('real continents have visible spacing and their children stay on the shaped floor', () => {
  const places = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')).map.places
  const layout = nestedLayout(places)
  const root = layout.rooms[layout.rootId]!
  for (const id of root.children) assert.ok(layout.rooms[id]!.shelf!.laneBelow - layout.rooms[id]!.shelf!.bottom >= 100)
  for (const room of Object.values(layout.rooms)) for (const id of room.children) {
    const child = layout.rooms[id]!
    for (const point of [{ x: child.x, y: child.y }, { x: child.x + child.width, y: child.y + child.height }]) {
      assert.equal(roomContains(room, point), true, `child ${id} must remain on room ${room.id}`)
    }
  }
})

test('curtains respect the stepped room outline', () => {
  const layout = nestedLayout([{ id: 1, parent_id: null }, { id: 2, parent_id: 1, quiet: true }])
  const room = layout.rooms[2]!
  assert.ok(room.notch)
  const cells = curtainCells(room, 0x557354)
  assert.equal(cells.reduce((sum, cell) => sum + cell.width * cell.height, 0),
    roomFloorRects(room, 4).reduce((sum, rect) => sum + rect.width * rect.height, 0))
  for (const cell of cells) assert.equal(roomContains(room, { x: cell.x + cell.width, y: cell.y + cell.height }, 4), true)
})
