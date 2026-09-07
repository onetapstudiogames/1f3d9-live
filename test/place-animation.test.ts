import test from 'node:test'
import assert from 'node:assert/strict'
import { nestedLayout, type Room } from '../src/ground/nested.ts'
import { createClock } from '../src/replay/index.ts'
import {
  advanceToPlaceMoment, animationProgress, brickCount, contentHiddenRooms,
  placeAnimation, signScale, stepPlaceAnimations, wallBricks,
} from '../src/place-animation.ts'

function room(door: Room['door'], quiet = false): Room {
  return { id: 2, parentId: 1, name: 'room', quiet, depth: 1, x: 10, y: 20,
    width: 120, height: 90, door, standing: { x: 20, y: 30, width: 100, height: 70 }, children: [] }
}

test('wall bricks are crisp, staggered, and leave the door wall open', () => {
  const doors = [{ x: 70, y: 20 }, { x: 70, y: 110 }, { x: 10, y: 65 }, { x: 130, y: 65 }]
  for (const door of doors) {
    const bricks = wallBricks(room(door))
    assert.ok(bricks.length > 0)
    assert.ok(bricks.every(brick => [brick.x, brick.y, brick.width, brick.height].every(Number.isInteger)))
    assert.ok(bricks.every(brick => brick.width > 0 && brick.height > 0 && (brick.width <= 16 || brick.height <= 16)))
    const horizontal = door.y === 20 || door.y === 110
    assert.equal(bricks.some(brick => horizontal
      ? brick.y <= door.y && brick.y + brick.height > door.y && brick.x < door.x + 22 && brick.x + brick.width > door.x - 22
      : brick.x <= door.x && brick.x + brick.width > door.x && brick.y < door.y + 22 && brick.y + brick.height > door.y - 22), false)
  }
  const courses = wallBricks(room({ x: 70, y: 20 })).filter(brick => brick.x < 30 && brick.y < 28)
  assert.notEqual(courses[0]?.x, courses.find(brick => brick.y !== courses[0]?.y)?.x)
})

test('quiet rooms have complete walls without a door opening', () => {
  const bricks = wallBricks(room({ x: 70, y: 20 }, true))
  assert.ok(bricks.some(brick => brick.y <= 20 && brick.y + brick.height > 20 && brick.x < 70 && brick.x + brick.width > 70))
})

test('place animation timing is bounded and malformed values stay finite', () => {
  const founding = placeAnimation('founding', 2, 'c1', 100, 120)
  assert.equal(founding.duration, 1600)
  assert.equal(placeAnimation('founding', 2, 'c2', 0, 1200).duration, 600)
  assert.equal(placeAnimation('renaming', 2, 'c3', 0, 1200).duration, 200)
  assert.equal(placeAnimation('renaming', 2, 'c4', Number.NaN, Number.NaN).startedAt, 0)
  assert.ok(Number.isFinite(placeAnimation('founding', 2, 'c5', 0, Number.POSITIVE_INFINITY).duration))
  assert.equal(animationProgress(founding, 99), 0)
  assert.equal(animationProgress(founding, 100), 0)
  assert.equal(animationProgress(founding, 1700), 1)
  assert.equal(animationProgress(founding, Number.NaN), 0)
  assert.equal(brickCount(11, 0.5), 5)
  assert.equal(brickCount(Number.NaN, 2), 0)
  assert.equal(signScale(-1), 0)
  assert.equal(signScale(0.5), 0.5)
  assert.equal(signScale(2), 1)
})

test('active animations expire and incoming change ids are deduplicated', () => {
  const old = placeAnimation('renaming', 2, 'same', 0)
  const fresh = placeAnimation('founding', 3, 'new', 100)
  assert.deepEqual(stepPlaceAnimations([old], [old, fresh], 100), [old, fresh])
  assert.deepEqual(stepPlaceAnimations([old], [old], 10_000), [old])
  assert.deepEqual(stepPlaceAnimations([old], [], 10_000), [])
})

test('hidden content includes founding rooms and all descendants', () => {
  const layout = nestedLayout([
    { id: 1, parent_id: null }, { id: 2, parent_id: 1, quiet: true },
    { id: 3, parent_id: 2 }, { id: 4, parent_id: 1 },
  ])
  const active = [placeAnimation('founding', 2, 'c1', 0)]
  assert.deepEqual([...contentHiddenRooms(layout, new Set([4]), active)].sort(), [2, 3, 4])
})

test('clock stops at the earliest crossed place moment', () => {
  const clock = createClock('2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 1)
  assert.equal(advanceToPlaceMoment(clock, 30_000, [clock.time + 25_000, clock.time + 10_000, Number.NaN]).time, clock.time + 10_000)
  assert.equal(advanceToPlaceMoment({ ...clock, time: clock.time + 10_000 }, 5_000,
    [clock.time + 10_000, clock.time + 15_000]).time, clock.time + 15_000)
  const paused = { ...clock, paused: true }
  assert.equal(advanceToPlaceMoment(paused, 30_000, [clock.time + 10_000]), paused)
})
