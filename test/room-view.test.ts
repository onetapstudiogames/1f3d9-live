import assert from 'node:assert/strict'
import test from 'node:test'

import type { ReplayPlace, Resident } from '../src/city/types.ts'
import type { NestedLayout, Room } from '../src/ground/nested.ts'
import { allocateRoomCrowdingFrame } from '../src/room-crowding.ts'
import { busiestRoom, projectRoomPoint, roomIsPublic, roomViewportUsable, singleRoomLayout } from '../src/room-view.ts'

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
const resident = (id: number, placeId: number | null, asleep = false): Resident => ({
  id, handle: `resident-${id}`, model: '', joined_at: '', has_drawing: true,
  current_place_id: placeId, asleep,
})
test('the opening room is the public leaf with the most residents standing now', () => {
  const places = [place(1, null), place(2, 1), place(3, 1)]
  const census = [resident(1, 2), resident(2, 2), resident(3, 3), resident(4, 1)]
  assert.equal(busiestRoom(places, census), 2)
})

test('quiet rooms, their descendants, unknown rooms, and sleepers do not count as standing residents', () => {
  const places = [place(1, null), place(2, 1, true), place(3, 2), place(4, 1)]
  const census = [resident(1, 3), resident(2, 3), resident(3, 99), resident(4, 4, true), resident(5, 4)]
  assert.equal(busiestRoom(places, census), 4)
  const city = layout([{ ...room(1, null), children: Object.freeze([2, 4]) },
    { ...room(2, 1, true), children: Object.freeze([3]) }, room(3, 2), room(4, 1)])
  assert.equal(roomIsPublic(city, 1), true)
  assert.equal(roomIsPublic(city, 3), false)
  assert.equal(roomIsPublic(city, 99), false)
})

test('a public container remains eligible when it has no public child', () => {
  const places = [place(1, null), place(2, 1, true), place(3, null)]
  assert.equal(busiestRoom(places, [resident(1, 1), resident(2, 1), resident(3, 3)]), 1)
})

test('public leaves replace their containers and ties choose the lowest place id', () => {
  const places = [place(1, null), place(2, 1), place(3, 1), place(4, null)]
  assert.equal(busiestRoom(places, [resident(1, 1), resident(2, 1), resident(3, 3), resident(4, 2)]), 2)
  assert.equal(busiestRoom(places, []), 2)
  assert.equal(busiestRoom([], []), null)
})

test('room viewport usability requires enough standing space for one full figure', () => {
  assert.equal(roomViewportUsable(168, 242), true)
  assert.equal(roomViewportUsable(167.999, 600), false)
  assert.equal(roomViewportUsable(136, 600), false)
  assert.equal(roomViewportUsable(168, 241.999), false)
  assert.equal(roomViewportUsable(Number.NaN, 242), false)
  assert.equal(roomViewportUsable(168, Number.POSITIVE_INFINITY), false)

  const exact = singleRoomLayout(room(6, null), 168, 242).rooms[6]!
  assert.deepEqual({ width: exact.standing.width, height: exact.standing.height }, { width: 56, height: 56 })
  const placement = allocateRoomCrowdingFrame([{
    id: 'resident:1', kind: 'resident', priority: 1,
    preferred: { x: exact.standing.x + 28, y: exact.standing.y + 28 },
  }], exact.standing).placements['resident:1']
  assert.equal(placement?.visible, true)
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
    const target = singleRoomLayout(source, 375, 242).rooms[source.id]!
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
