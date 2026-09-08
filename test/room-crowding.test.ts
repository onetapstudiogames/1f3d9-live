import assert from 'node:assert/strict'
import test from 'node:test'

import {
  allocateRoomCrowding,
  visibleRoomLabels,
  type RoomCrowdingEntry,
  type RoomCrowdingPlacement,
} from '../src/room-crowding.ts'

const entry = (id: string, x: number, y: number, priority = 0,
  kind: 'resident' | 'thing' = 'resident'): RoomCrowdingEntry =>
  Object.freeze({ id, kind, preferred: Object.freeze({ x, y }), priority })

function overlap(left: RoomCrowdingPlacement, right: RoomCrowdingPlacement): boolean {
  return Math.abs(left.x - right.x) < 32 && Math.abs(left.y - right.y) < 32
}

function overlapWithBob(left: RoomCrowdingPlacement, right: RoomCrowdingPlacement): boolean {
  return Math.abs(left.x - right.x) < 36 && Math.abs(left.y - right.y) < 36
}

test('allocates colliding projected residents and things deterministically without sprite overlap', () => {
  const entries = [entry('resident:2', 120, 120), entry('thing:8', 120, 120, 1, 'thing'),
    entry('resident:1', 121, 120, 2)]
  const band = { x: 40, y: 70, width: 1_200, height: 300 }
  const first = allocateRoomCrowding(entries, band)
  const second = allocateRoomCrowding([...entries].reverse(), band)

  assert.deepEqual(first, second)
  const visible = Object.values(first).filter(value => value.visible)
  assert.equal(visible.length, 3)
  for (let left = 0; left < visible.length; left += 1) {
    for (let right = left + 1; right < visible.length; right += 1) {
      assert.equal(overlap(visible[left]!, visible[right]!), false)
      assert.equal(overlapWithBob(visible[left]!, visible[right]!), false)
    }
  }
})

test('keeps a stable seat offset while a projected resident moves slightly', () => {
  const band = { x: 0, y: 0, width: 160, height: 96 }
  const first = allocateRoomCrowding([entry('a', 48, 48), entry('b', 48, 48)], band)
  const moved = allocateRoomCrowding([entry('a', 51, 50), entry('b', 51, 50)], band, first)

  for (const id of ['a', 'b']) {
    assert.equal(moved[id]!.offsetX, first[id]!.offsetX)
    assert.equal(moved[id]!.offsetY, first[id]!.offsetY)
    assert.equal(moved[id]!.x, first[id]!.x + 3)
    assert.equal(moved[id]!.y, first[id]!.y + 2)
  }
})

test('375px viewport overflow stays bounded and hides lower-priority figures honestly', () => {
  const band = { x: 8, y: 108, width: 359, height: 48 }
  const entries = [entry('followed', 180, 132, 100), entry('speaker', 180, 132, 80),
    entry('walker', 180, 132, 60), ...Array.from({ length: 20 }, (_, index) => entry(`idle:${index}`, 180, 132))]
  const placed = allocateRoomCrowding(entries, band)

  assert.equal(placed.followed!.visible, true)
  assert.equal(placed.speaker!.visible, true)
  assert.equal(placed.walker!.visible, true)
  assert.ok(Object.values(placed).some(value => !value.visible))
  for (const value of Object.values(placed).filter(value => value.visible)) {
    assert.ok(value.x >= band.x + 16 && value.x <= band.x + band.width - 16)
    assert.ok(value.y >= band.y + 16 && value.y <= band.y + band.height - 16)
  }
})

test('invalid or too-small bands hide every valid figure and ignore invalid entries', () => {
  assert.deepEqual(allocateRoomCrowding([entry('a', 1, 1)], { x: 0, y: 0, width: 31, height: 31 }), {
    a: { id: 'a', kind: 'resident', x: 1, y: 1, visible: false, offsetX: 0, offsetY: 0 },
  })
  assert.deepEqual(allocateRoomCrowding([
    entry('', 1, 1), entry('bad', Number.NaN, 1), entry('ok', 1, 1),
  ], { x: 0, y: 0, width: Number.NaN, height: 100 }), {
    ok: { id: 'ok', kind: 'resident', x: 1, y: 1, visible: false, offsetX: 0, offsetY: 0 },
  })
})

test('label allocation keeps priority plates and removes collisions and invalid boxes', () => {
  const visible = visibleRoomLabels([
    { id: 'idle', x: 90, y: 100, width: 70, height: 18, priority: 0 },
    { id: 'followed', x: 100, y: 100, width: 80, height: 18, priority: 100 },
    { id: 'separate', x: 220, y: 100, width: 60, height: 18, priority: 0 },
    { id: 'bad', x: Number.NaN, y: 0, width: 20, height: 10, priority: 999 },
  ])
  assert.deepEqual([...visible].sort(), ['followed', 'separate'])
  assert.deepEqual([...visibleRoomLabels([
    { id: 'b', x: 0, y: 0, width: 20, height: 12, priority: 1 },
    { id: 'a', x: 0, y: 0, width: 20, height: 12, priority: 1 },
  ])], ['a'])
})
