import assert from 'node:assert/strict'
import test from 'node:test'

import type { Room } from '../src/ground/nested.ts'
import { createRoomWalk, ROOM_WALK_SPEED, sampleRoomWalk } from '../src/room-motion.ts'
import { resizeRoomWalk } from '../src/room-walk-resize.ts'

const room = (id: number, width: number, height: number, door: Readonly<{ x: number; y: number }>): Room => ({
  id, parentId: null, name: String(id), quiet: false, depth: 0, x: 8, y: 8, width, height, door,
  standing: { x: 56, y: 108, width: width - 96, height: height - 170 }, children: [], notch: null, shelf: null,
})

const oldSource = room(1, 384, 304, { x: 200, y: 312 })
const newSource = room(1, 484, 364, { x: 250, y: 372 })
const oldTarget = room(2, 384, 304, { x: 8, y: 150 })
const newTarget = room(2, 484, 364, { x: 8, y: 180 })
const oldPlan = createRoomWalk(oldSource, oldTarget, { x: 130, y: 150 }, { x: 220, y: 180 }, [], [])!

test('mid-departure resize preserves the current pose and routes through the new door', () => {
  const elapsed = 500
  const before = sampleRoomWalk(oldPlan, elapsed)
  assert.equal(before.phase, 'departure')
  const resized = resizeRoomWalk(oldPlan, elapsed, oldSource, newSource, oldTarget, newTarget,
    { x: 280, y: 210 }, [], [])
  assert.ok(resized)
  const current = sampleRoomWalk(resized, 0)
  assert.equal(current.phase, 'departure')
  assert.ok(resized.departure.some(point => point.x === newSource.door.x && point.y === newSource.door.y))
  assert.equal(resized.durationMs, resized.distance / ROOM_WALK_SPEED * 1_000)
  assert.notDeepEqual({ x: current.x, y: current.y }, { x: before.x, y: before.y })
})

test('resize on the outside departure leg preserves outward offset and never recrosses the door', () => {
  const lastLeg = Math.hypot(oldPlan.departure.at(-1)!.x - oldPlan.departure.at(-2)!.x,
    oldPlan.departure.at(-1)!.y - oldPlan.departure.at(-2)!.y)
  const elapsed = (oldPlan.departureDistance - lastLeg / 2) / ROOM_WALK_SPEED * 1_000
  const resized = resizeRoomWalk(oldPlan, elapsed, oldSource, newSource, oldTarget, newTarget,
    { x: 280, y: 210 }, [], [])
  assert.ok(resized)
  assert.equal(resized.departure[0]!.x, newSource.door.x)
  assert.ok(resized.departure[0]!.y > newSource.door.y)
  assert.ok(resized.departure.at(-1)!.y > resized.departure[0]!.y)
  assert.equal(resized.departure.filter(point => point.x === newSource.door.x && point.y === newSource.door.y).length, 0)
})

test('mid-arrival inside resize continues from the rebased pose and a blocking wall returns null', () => {
  const outsideLeg = Math.hypot(oldPlan.arrival[1]!.x - oldPlan.arrival[0]!.x,
    oldPlan.arrival[1]!.y - oldPlan.arrival[0]!.y)
  const elapsed = (oldPlan.departureDistance + outsideLeg + 70) / ROOM_WALK_SPEED * 1_000
  assert.equal(sampleRoomWalk(oldPlan, elapsed).phase, 'arrival')
  const resized = resizeRoomWalk(oldPlan, elapsed, oldSource, newSource, oldTarget, newTarget,
    { x: 280, y: 210 }, [], [])
  assert.ok(resized)
  const current = sampleRoomWalk(resized, 0)
  assert.equal(current.phase, 'arrival')
  assert.notDeepEqual(resized.arrival[0], resized.arrival.at(-1))
  assert.ok(resized.arrival[0]!.x >= newTarget.x)

  const wall = [{ x: 8, y: 150, width: 484, height: 70 }]
  assert.equal(resizeRoomWalk(oldPlan, elapsed, oldSource, newSource, oldTarget, newTarget,
    { x: 280, y: 260 }, [], wall), null)
})

test('resizing in the inner door corridor continues the current leg without restarting it', () => {
  const elapsed = (oldPlan.departureDistance + 12) / ROOM_WALK_SPEED * 1_000
  const resized = resizeRoomWalk(oldPlan, elapsed, oldSource, newSource, oldTarget, newTarget,
    { x: 280, y: 210 }, [], [])!
  assert.ok(resized)
  assert.equal(resized.arrival[0]!.y, newTarget.door.y)
  assert.ok(Math.abs(resized.arrival[0]!.x - (newTarget.door.x + 12)) < 1e-6)
  assert.ok(resized.arrival.every(point => point.x > newTarget.door.x))
})
