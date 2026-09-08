import assert from 'node:assert/strict'
import test from 'node:test'

import type { ReplayPlace, Resident } from '../src/city/types.ts'
import type { NestedLayout, Room } from '../src/ground/nested.ts'
import { busiestRoom, projectRoomPoint, roomIsPublic, singleRoomLayout } from '../src/room-view.ts'

const room = (id: number, parentId: number | null, quiet = false): Room => Object.freeze({
  id, parentId, name: `room ${id}`, quiet, depth: parentId === null ? 0 : 1,
  x: id * 100, y: id * 50, width: 240, height: 170,
  door: Object.freeze({ x: id * 100 + 240, y: id * 50 + 85 }),
  standing: Object.freeze({ x: id * 100 + 24, y: id * 50 + 24, width: 192, height: 90 }),
  children: Object.freeze([]), notch: null, shelf: null,
})

const layout = (rooms: readonly Room[]): NestedLayout => Object.freeze({
  rooms: Object.freeze(Object.fromEntries(rooms.map(value => [value.id, value]))),
  rootId: rooms[0]!.id, width: 1_000, height: 800,
})

const place = (id: number, parent_id: number | null, quiet = false): ReplayPlace => ({
  id, parent_id, quiet, name: `room ${id}`, owner: null, owner_id: null, has_drawing: false,
})
const resident = (id: number, placeId: number | null, visible = true): Resident => ({
  id, handle: visible ? `resident-${id}` : null, model: '', joined_at: '', has_drawing: visible,
  current_place_id: placeId, asleep: false,
})

test('busiest room counts exact census occupants and breaks ties by room id', () => {
  const places = [place(1, null), place(2, 1), place(3, 1)]
  assert.equal(busiestRoom(places, [resident(1, 3), resident(2, 2), resident(3, 2)]), 2)
  assert.equal(busiestRoom(places, [resident(1, 3), resident(2, 2)]), 2)
})

test('busiest room excludes unknown and quiet branches, then falls back to the lowest public id', () => {
  const places = [place(1, null), place(2, 1, true), place(3, 2), place(4, 1)]
  assert.equal(busiestRoom(places, [resident(1, 3), resident(2, 99), resident(3, null)]), 1)
  assert.equal(busiestRoom(places, []), 1)
  const city = layout([{ ...room(1, null), children: Object.freeze([2, 4]) },
    { ...room(2, 1, true), children: Object.freeze([3]) }, room(3, 2), room(4, 1)])
  assert.equal(roomIsPublic(city, 1), true)
  assert.equal(roomIsPublic(city, 3), false)
  assert.equal(roomIsPublic(city, 99), false)
})

test('single-room layout fills the viewport and preserves the selected room facts', () => {
  const source = room(4, 1, true)
  const isolated = singleRoomLayout(source, 375, 812)
  const result = isolated.rooms[4]!
  assert.deepEqual({ x: result.x, y: result.y, width: result.width, height: result.height },
    { x: 8, y: 8, width: 359, height: 796 })
  assert.equal(result.name, source.name)
  assert.equal(result.quiet, true)
  assert.equal(result.parentId, null)
  assert.deepEqual(result.children, [])
  assert.ok(result.standing.y > result.y + 24)
  assert.ok(result.standing.y + result.standing.height < result.y + result.height - 24)
  assert.equal(isolated.rootId, 4)
})

test('room points project by standing-area proportions without clamping recorded endpoints', () => {
  const source = room(2, 1)
  const target = singleRoomLayout(source, 640, 480).rooms[2]!
  assert.deepEqual(projectRoomPoint({ x: source.standing.x + 96, y: source.standing.y + 45 }, source, target),
    { x: target.standing.x + target.standing.width / 2, y: target.standing.y + target.standing.height / 2 })
  const door = projectRoomPoint(source.door, source, target)
  assert.deepEqual(door, target.door)
  assert.equal(projectRoomPoint({ x: source.x - 1, y: source.y }, source, target), null)
})

test('all source walls and doors project inside a skinny displayed room', () => {
  const base = room(5, 1)
  const doors = [
    { x: base.x, y: base.y + 31 },
    { x: base.x + base.width, y: base.y + 139 },
    { x: base.x + 47, y: base.y },
    { x: base.x + 193, y: base.y + base.height },
  ]
  for (const sourceDoor of doors) {
    const source = { ...base, door: sourceDoor }
    const target = singleRoomLayout(source, 375, 220).rooms[source.id]!
    assert.deepEqual(projectRoomPoint(sourceDoor, source, target), target.door)
    for (const point of [
      { x: source.x, y: source.y }, { x: source.x + source.width, y: source.y },
      { x: source.x, y: source.y + source.height }, { x: source.x + source.width, y: source.y + source.height },
      { x: source.standing.x, y: source.standing.y },
      { x: source.standing.x + source.standing.width, y: source.standing.y + source.standing.height },
    ]) {
      const projected = projectRoomPoint(point, source, target)
      assert.ok(projected && Number.isFinite(projected.x) && Number.isFinite(projected.y))
      assert.ok(projected.x >= target.x && projected.x <= target.x + target.width)
      assert.ok(projected.y >= target.y && projected.y <= target.y + target.height)
    }
    assert.deepEqual(projectRoomPoint(source.standing, source, target),
      { x: target.standing.x, y: target.standing.y })
  }
})
