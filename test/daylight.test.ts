import { roomContains, roomOutline } from '../src/ground/room-shape.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { daylightAt, roomWindows, windowsLit } from '../src/daylight.ts'
import { nestedLayout, type Place, type Room } from '../src/ground/nested.ts'

const atUtc = (hour: number, minute = 0): number => Date.UTC(2026, 8, 7, hour, minute)

test('daylight follows the recorded UTC clock at each period boundary', () => {
  assert.deepEqual(daylightAt(atUtc(0)), { color: 0x163b92, alpha: 0.45 })
  assert.deepEqual(daylightAt(atUtc(5)), { color: 0x163b92, alpha: 0.45 })
  assert.deepEqual(daylightAt(atUtc(6)), { color: 0xf0ad78, alpha: 0.12 })
  assert.deepEqual(daylightAt(atUtc(10)), { color: 0xffffff, alpha: 0 })
  assert.deepEqual(daylightAt(atUtc(12)), { color: 0xffffff, alpha: 0 })
  assert.deepEqual(daylightAt(atUtc(17)), { color: 0xffffff, alpha: 0 })
  assert.deepEqual(daylightAt(atUtc(18)), { color: 0xf0a04a, alpha: 0.18 })
  assert.deepEqual(daylightAt(atUtc(20)), { color: 0x163b92, alpha: 0.45 })
  assert.deepEqual(daylightAt(Date.UTC(2026, 8, 8, 0)), daylightAt(atUtc(0)))
})

test('daylight changes smoothly within a period and never exceeds the night limit', () => {
  const morning = daylightAt(atUtc(8))
  assert.ok(morning.alpha > 0 && morning.alpha < 0.12)
  assert.notEqual(morning.color, daylightAt(atUtc(6)).color)
  for (let hour = 0; hour < 24; hour += 1) assert.ok(daylightAt(atUtc(hour)).alpha <= 0.45)
})

test('invalid recorded times are neutral and leave windows unlit', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 8.65e15]) {
    assert.deepEqual(daylightAt(value), { color: 0xffffff, alpha: 0 })
    assert.equal(windowsLit(value), false)
  }
})

test('windows light from 20:00 inclusive until 06:00 exclusive in UTC', () => {
  assert.equal(windowsLit(atUtc(19, 59)), false)
  assert.equal(windowsLit(atUtc(20)), true)
  assert.equal(windowsLit(atUtc(0)), true)
  assert.equal(windowsLit(atUtc(5, 59)), true)
  assert.equal(windowsLit(atUtc(6)), false)
})

const assertSafeWindows = (room: Room): void => {
  const windows = roomWindows(room)
  assert.ok(windows.length >= 1 && windows.length <= 3)
  assert.deepEqual(roomWindows(Object.freeze({ ...room })), windows)
  assert.equal(Object.isFrozen(windows), true)
  for (const window of windows) {
    assert.equal(Object.isFrozen(window), true)
    assert.ok(window.x >= room.x && window.y >= room.y)
    assert.ok(window.x + window.width <= room.x + room.width)
    assert.ok(window.y + window.height <= room.y + room.height)
    const center = { x: window.x + window.width / 2, y: window.y + window.height / 2 }
    const wall = roomOutline(room).find(([a, b]) => a.y === b.y
      ? Math.abs(center.y - a.y) === 5 && center.x >= Math.min(a.x, b.x) + 24 && center.x <= Math.max(a.x, b.x) - 24
      : Math.abs(center.x - a.x) === 5 && center.y >= Math.min(a.y, b.y) + 24 && center.y <= Math.max(a.y, b.y) - 24)
    assert.ok(wall, `window in room ${room.id} must clear corners on its actual outline`)
    for (const point of [{ x: window.x, y: window.y }, { x: window.x + window.width, y: window.y + window.height }]) {
      assert.equal(roomContains(room, point), true)
    }
    assert.ok(Math.hypot(center.x - room.door.x, center.y - room.door.y) >= 34, 'window clears the doorway')
  }
}

test('window geometry is deterministic and clears doors on all four walls', () => {
  const layout = nestedLayout([{ id: 1, parent_id: null }, ...Array.from({ length: 8 }, (_, index) => ({ id: index + 2, parent_id: 1 }))])
  const walls = new Set<string>()
  for (const room of Object.values(layout.rooms)) {
    assertSafeWindows(room)
    const { x, y, height, door } = room
    walls.add(door.y === y ? 'top' : door.y === y + height ? 'bottom' : door.x === x ? 'left' : 'right')
  }
  assert.deepEqual([...walls].sort(), ['bottom', 'left', 'right', 'top'])
})

test('window geometry stays safe across every room in the recorded map', async () => {
  const replay = JSON.parse(await readFile(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as { map: { places: readonly Place[] } }
  const layout = nestedLayout(replay.map.places)
  for (const room of Object.values(layout.rooms)) assertSafeWindows(room)
})
