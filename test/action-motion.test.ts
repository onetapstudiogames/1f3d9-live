import assert from 'node:assert/strict'
import test from 'node:test'

import type { Room } from '../src/ground/nested.ts'
import { ACTION_SHAKE_MS, ACTION_WALK_SPEED, createActionMotion, sampleActionMotion } from '../src/action-motion.ts'

const room: Room = Object.freeze({ id: 1, parentId: null, name: 'room', quiet: false, depth: 0,
  x: 0, y: 0, width: 360, height: 260, door: { x: 0, y: 130 },
  standing: { x: 30, y: 40, width: 300, height: 180 }, children: [], notch: null, shelf: null })

test('action approach bends around an obstacle at 140 CSS pixels per second', () => {
  const plan = createActionMotion(room, { x: 70, y: 130 }, { x: 280, y: 130 },
    [{ x: 150, y: 95, width: 56, height: 70 }])
  assert.ok(plan)
  assert.equal(ACTION_WALK_SPEED, 140)
  assert.equal(plan.path.length > 2, true)
  assert.equal(plan.walkDurationMs, plan.distance / ACTION_WALK_SPEED * 1_000)
  const half = sampleActionMotion(plan, plan.walkDurationMs / 2)
  assert.equal(half.phase, 'approach')
  assert.equal(Math.abs(half.travelled - plan.distance / 2) < 1e-6, true)
})

test('action stops beside the thing, then shakes for exactly one second', () => {
  const plan = createActionMotion(room, { x: 70, y: 130 }, { x: 280, y: 130 }, [])!
  const arrived = sampleActionMotion(plan, plan.walkDurationMs)
  assert.deepEqual({ x: arrived.x, y: arrived.y }, plan.target)
  assert.equal(arrived.phase, 'shake')
  assert.notEqual(sampleActionMotion(plan, plan.walkDurationMs + 125).offsetX, 0)
  assert.equal(sampleActionMotion(plan, plan.walkDurationMs + ACTION_SHAKE_MS - 0.01).done, false)
  const done = sampleActionMotion(plan, plan.durationMs)
  assert.equal(done.done, true)
  assert.equal(done.offsetX, 0)
})

test('action returns null when reservations leave no clear route or beside-target space', () => {
  assert.equal(createActionMotion(room, { x: 70, y: 130 }, { x: 280, y: 130 }, [
    { x: 0, y: 0, width: 360, height: 260 },
  ]), null)
})

test('an edge thing chooses a reachable beside point with the full resident footprint inside the standing band', () => {
  const thing = { x: room.standing.x + 16, y: room.standing.y + 16 }
  const plan = createActionMotion(room, { x: 180, y: 150 }, thing,
    [{ x: thing.x - 16, y: thing.y - 16, width: 32, height: 32 }])
  assert.ok(plan)
  assert.equal(plan.target.x - 28 >= room.standing.x, true)
  assert.equal(plan.target.y - 28 >= room.standing.y, true)
  assert.equal(plan.target.x + 28 <= room.standing.x + room.standing.width, true)
  assert.equal(plan.target.y + 28 <= room.standing.y + room.standing.height, true)
  assert.equal(Math.hypot(plan.target.x - thing.x, plan.target.y - thing.y) <= 64, true)
})
