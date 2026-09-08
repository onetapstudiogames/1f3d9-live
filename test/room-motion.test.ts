import assert from 'node:assert/strict'
import test from 'node:test'

import type { Room } from '../src/ground/nested.ts'
import {
  IDLE_DRIFT_SPEED,
  ROOM_WALK_SPEED,
  roomMovesConflict,
  arrivalSpot,
  createIdleDrift,
  createRoomWalk,
  idleDriftDueAt,
  sampleIdleDrift,
  sampleRoomWalk,
} from '../src/room-motion.ts'

const room = (id: number, door: Readonly<{ x: number; y: number }>): Room => Object.freeze({
  id, parentId: null, name: `room ${id}`, quiet: false, depth: 0,
  x: 0, y: 0, width: 300, height: 240, door,
  standing: Object.freeze({ x: 40, y: 50, width: 220, height: 130 }),
  children: Object.freeze([]), notch: null, shelf: null,
})

test('walks sharing either doorway take turns while unrelated rooms are independent', () => {
  assert.equal(roomMovesConflict({ fromId: 1, toId: 2 }, { fromId: 3, toId: 2 }), true)
  assert.equal(roomMovesConflict({ fromId: 1, toId: 2 }, { fromId: 2, toId: 3 }), true)
  assert.equal(roomMovesConflict({ fromId: null, toId: 2 }, { fromId: null, toId: 3 }), false)
  assert.equal(roomMovesConflict({ fromId: 1, toId: 2 }, { fromId: 3, toId: 4 }), false)
})

test('recorded room walk leaves fully through the source door before arrival begins', () => {
  const source = room(1, { x: 300, y: 120 })
  const target = room(2, { x: 0, y: 120 })
  const plan = createRoomWalk(source, target, { x: 120, y: 100 }, { x: 180, y: 100 }, [], [])
  assert.ok(plan)
  assert.equal(ROOM_WALK_SPEED, 140)
  assert.deepEqual(plan.departure[0], { x: 120, y: 100 })
  assert.deepEqual(plan.departure.at(-2), source.door)
  assert.ok(plan.departure.at(-1)!.x > source.x + source.width + 30)
  assert.ok(plan.arrival[0]!.x < target.x - 30)
  assert.deepEqual(plan.arrival[1], target.door)

  const departureEnd = plan.departureDistance / ROOM_WALK_SPEED * 1_000
  assert.equal(sampleRoomWalk(plan, departureEnd - 0.01).roomId, 1)
  assert.equal(sampleRoomWalk(plan, departureEnd).phase, 'arrival')
  assert.equal(sampleRoomWalk(plan, departureEnd).roomId, 2)
  assert.equal(sampleRoomWalk(plan, plan.durationMs).done, true)
  assert.deepEqual(sampleRoomWalk(plan, plan.durationMs), {
    x: 180, y: 100, roomId: 2, phase: 'done', done: true, flipX: false,
  })
})

test('offscreen resident has only an arrival and still enters through the door', () => {
  const target = room(4, { x: 150, y: 0 })
  const plan = createRoomWalk(undefined, target, { x: 1, y: 1 }, { x: 180, y: 100 }, [], [])
  assert.ok(plan)
  assert.deepEqual(plan.departure, [])
  assert.deepEqual(plan.arrival[1], target.door)
  assert.equal(sampleRoomWalk(plan, 0).phase, 'arrival')
  assert.equal(sampleRoomWalk(plan, 0).roomId, 4)
})

test('walk routing clears resident and thing rectangles and rejects a sealed room', () => {
  const source = room(1, { x: 300, y: 120 })
  const target = room(2, { x: 0, y: 120 })
  const blocker = { x: 175, y: 80, width: 56, height: 56 }
  const plan = createRoomWalk(source, target, { x: 100, y: 108 }, { x: 180, y: 100 }, [blocker], [])
  assert.ok(plan)
  assert.ok(plan.departure.length > 3, 'the path bends around the expanded obstacle')

  const wall = { x: 0, y: 86, width: 300, height: 68 }
  assert.equal(createRoomWalk(source, target, { x: 100, y: 108 }, { x: 180, y: 100 }, [wall], []), null)
})

test('arrival spot prefers a safe point and uses a free candidate when it is occupied', () => {
  const target = room(2, { x: 0, y: 120 })
  const occupied = [{ x: 152, y: 72, width: 56, height: 56 }]
  const spot = arrivalSpot(target, { x: 180, y: 100 }, occupied, [{ x: 90, y: 100 }])
  assert.deepEqual(spot, { x: 90, y: 100 })
  assert.equal(arrivalSpot(target, { x: 180, y: 100 }, [{ x: 0, y: 0, width: 300, height: 240 }]), null)
})

test('idle drift is deterministic, due around ten seconds, short, safe, and sampled at idle speed', () => {
  const target = room(7, { x: 0, y: 120 })
  const due = idleDriftDueAt(7, 1_000)
  assert.ok(due >= 10_000 && due <= 12_000)
  const first = createIdleDrift(7, 3, target, { x: 150, y: 110 }, [])
  const second = createIdleDrift(7, 3, target, { x: 150, y: 110 }, [])
  assert.deepEqual(first, second)
  assert.ok(first)
  assert.equal(IDLE_DRIFT_SPEED, 20)
  assert.ok(first.distance >= 12 && first.distance <= 24)
  const halfway = sampleIdleDrift(first, first.durationMs / 2)
  assert.equal(halfway.done, false)
  assert.ok(Math.abs(Math.hypot(halfway.x - first.from.x, halfway.y - first.from.y) - first.distance / 2) < 1e-6)
  assert.equal(sampleIdleDrift(first, first.durationMs).done, true)
})

test('idle drift returns null rather than stacking when every short segment is reserved', () => {
  const target = room(7, { x: 0, y: 120 })
  assert.equal(createIdleDrift(7, 3, target, { x: 150, y: 110 }, [
    { x: 100, y: 60, width: 100, height: 100 },
  ]), null)
})
