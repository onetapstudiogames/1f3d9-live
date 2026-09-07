import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ReplayFile, Resident } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { roomCapacity } from '../src/replay/simulation.ts'
import { hiddenRooms, planPlaces } from '../src/places.ts'
import { roomsToDraw } from '../src/room-art.ts'
import { minimapFrame, minimapPlan, minimapWorldPoint } from '../src/minimap.ts'

const replay = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
const census = [1, 2].flatMap(page => (JSON.parse(readFileSync(new URL(`./fixtures/residents-presence-page${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)
const layout = nestedLayout(replay.map.places, roomCapacity(replay, census))
const places = planPlaces(replay)
const plan = minimapPlan(layout, new Set([...places.foundings.keys(), ...places.unresolvedFoundings]))

test('the real saved map keeps exactly the same allowed outlines before and after founding', () => {
  for (const time of [Date.parse(replay.window_start), Date.parse(replay.window_end)]) {
    const hidden = hiddenRooms(places, layout, time)
    const frame = minimapFrame(plan, { x: 0, y: 0, width: layout.width, height: layout.height }, null, hidden)
    const actual = [...plan.staticRooms, ...frame.dynamicRooms].map(room => room.id).sort((a, b) => a - b)
    const expected = roomsToDraw(layout).filter(room => !hidden.has(room.id)).map(room => room.id).sort((a, b) => a - b)
    assert.deepEqual(actual, expected)
  }
})

test('every actual room centre maps back without changing its world location', () => {
  for (const room of Object.values(layout.rooms)) {
    const point = { x: room.x + room.width / 2, y: room.y + room.height / 2 }
    const mini = minimapFrame(plan, { x: 0, y: 0, width: 500, height: 400 }, point, new Set()).followed!
    const restored = minimapWorldPoint(plan, mini.x, mini.y)
    assert.ok(Math.abs(restored.x - point.x) < 0.00001)
    assert.ok(Math.abs(restored.y - point.y) < 0.00001)
  }
})

test('the view outline clips both near and far edges instead of exaggerating the visible area', () => {
  const square = { width: 100, height: 100, worldWidth: 100, worldHeight: 100, staticRooms: [], dynamicRooms: [] }
  assert.deepEqual(minimapFrame(square, { x: -10, y: -20, width: 30, height: 40 }, null, new Set()).viewport,
    { x: 0, y: 0, width: 20, height: 20 })
  assert.deepEqual(minimapFrame(square, { x: 90, y: 80, width: 30, height: 40 }, null, new Set()).viewport,
    { x: 90, y: 80, width: 10, height: 20 })
  const outside = minimapFrame(square, { x: 200, y: 200, width: 30, height: 40 }, null, new Set()).viewport
  assert.ok(outside.x + outside.width <= 100 && outside.y + outside.height <= 100)
})
