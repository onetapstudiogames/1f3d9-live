import assert from 'node:assert/strict'
import test from 'node:test'

import type { ReplayEvent } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import type { ResidentState } from '../src/replay/simulation.ts'
import { RoomMotion } from '../src/scenes/RoomMotion.ts'

const layout = nestedLayout([
  { id: 1, parent_id: null, name: 'one' },
  { id: 2, parent_id: 1, name: 'two' },
])
const resident = (overrides: Partial<ResidentState> = {}): ResidentState => ({
  id: 7, handle: 'seven', joinedAt: null, sparkle: null, placeId: 1, x: 100, y: 80,
  flipX: false, walking: false, visible: true, bubble: null, queue: [], path: [], walkElapsed: 0,
  walkDuration: 0, destinationId: null, destination: null, walkEventId: null, transferUntil: null,
  ...overrides,
})
const move = (id = '12'): ReplayEvent => ({ actor: 'seven', at: '2026-01-01T00:00:00Z', change_id: id,
  event_id: 12, kind: 'action', detail: { action: 'move', status: 'applied', from_place_id: 1, to_place_id: 2 } })

test('controller keeps logical source until full departure, then finishes at the recorded destination', () => {
  const controller = new RoomMotion()
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, 7, new Set(), new Set())
  controller.remember({ 7: { ...resident(), x: 130, y: 130 } }, {})
  const started = controller.start(resident(), move(), { 7: resident() })
  assert.ok(started?.walking)
  assert.equal(started.placeId, 1)
  const pose = controller.presentation(1).poses.get(7)
  assert.equal(pose?.moving, true)
  assert.deepEqual(controller.diagnostics().map(row => [row.id, row.phase, row.speed]), [[7, 'departure', 140]])

  let current = started
  for (let frame = 0; frame < 1_000 && current.walking && current.placeId === 1; frame += 1) {
    current = controller.advance(current, 16) ?? current
  }
  assert.equal(current.placeId, 2)
  while (current.walking) current = controller.advance(current, 16) ?? current
  assert.equal(current.placeId, 2)
  assert.equal(current.walkEventId, null)
  assert.equal(controller.diagnostics()[0]?.phase, 'done')
})

test('suppressed startup move applies census destination without visible animation', () => {
  const controller = new RoomMotion()
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, null, new Set(), new Set(['12']))
  const current = resident({ placeId: 2 })
  const result = controller.start(current, move(), { 7: current })
  assert.ok(result)
  assert.equal(result.walking, false)
  assert.equal(result.placeId, 2)
  assert.equal(controller.presentation(1).poses.has(7), false)
})

test('move outside the selected room updates directly without inventing visible travel', () => {
  const controller = new RoomMotion()
  controller.configure(layout, {}, { width: 400, height: 320 }, null, null, new Set(), new Set())
  const result = controller.start(resident(), move(), { 7: resident() })
  assert.ok(result)
  assert.equal(result.walking, false)
  assert.equal(result.placeId, 2)
})

test('controller starts safe presentation-only idle motion around ten seconds', () => {
  const controller = new RoomMotion()
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, null, new Set(), new Set())
  const current = resident()
  controller.remember({ 7: { ...current, x: 130, y: 150 } }, {})
  controller.idle({ 7: current }, 0, 0, new Set())
  controller.idle({ 7: current }, 16, 12_000, new Set())
  const moving = controller.presentation(1).poses.get(7)
  assert.equal(moving?.moving, true)
  controller.remember({ 7: { ...current, x: 130, y: 150 } }, {})
  assert.equal(controller.presentation(1).poses.get(7)?.moving, true, 'a render snapshot cannot reset active idle motion')
  controller.idle({ 7: current }, 2_000, 14_000, new Set())
  const settled = controller.presentation(1).poses.get(7)
  assert.equal(settled?.moving, false)
  assert.equal(current.x, 100, 'idle motion does not alter recorded world coordinates')
})

test('destination-only arrival changes logical room immediately and walks onscreen', () => {
  const controller = new RoomMotion()
  controller.configure(layout, {}, { width: 400, height: 320 }, 2, null, new Set(), new Set())
  const started = controller.start(resident(), move(), { 7: resident() })
  assert.equal(started?.placeId, 2)
  assert.equal(started?.walking, true)
  assert.equal(controller.diagnostics()[0]?.phase, 'arrival')
})

test('resize replans an active walk through the new door and a too-small view holds it', () => {
  const controller = new RoomMotion()
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, 7, new Set(), new Set())
  controller.remember({ 7: { ...resident(), x: 130, y: 130 } }, {})
  let current = controller.start(resident(), move(), { 7: resident() })!
  current = controller.advance(current, 400)!
  const oldDoor = controller.diagnostics()[0]!.door
  controller.configure(layout, {}, { width: 500, height: 380 }, 1, 7, new Set(), new Set())
  current = controller.advance(current, 16)!
  const resized = controller.diagnostics()[0]!
  assert.notDeepEqual(resized.door, oldDoor)
  assert.ok(resized.path.some(point => point.x === resized.door.x && point.y === resized.door.y))
  const heldAt = current.walkElapsed
  controller.configure(layout, {}, { width: 100, height: 100 }, 1, 7, new Set(), new Set())
  current = controller.advance(current, 1_000)!
  assert.equal(current.walkElapsed, heldAt)
  controller.configure(layout, {}, { width: 450, height: 340 }, 1, 7, new Set(), new Set())
  current = controller.advance(current, 16)!
  assert.equal(current.walkElapsed, 16, 'recovery replans and resumes in the usable viewport')
  assert.notDeepEqual(controller.diagnostics()[0]?.door, resized.door)
})

test('a simultaneous arrival waits its recorded turn at the busy doorway', () => {
  const controller = new RoomMotion()
  controller.configure(layout, {}, { width: 500, height: 380 }, 2, null, new Set(), new Set())
  const one = resident()
  const two = resident({ id: 8, handle: 'eight', x: 140, y: 90 })
  const startedOne = controller.start(one, move('20'), { 7: one, 8: two })!
  const secondMove = { ...move('21'), actor: 'eight' }
  const startedTwo = controller.start(two, secondMove, { 7: startedOne, 8: two })
  assert.equal(startedOne.walking, true)
  assert.equal(startedTwo, null)
  const arrivedOne = controller.advance(startedOne, 1_000_000)!
  const nextTurn = controller.start(two, secondMove, { 7: arrivedOne, 8: two })!
  assert.equal(nextTurn.walking, true)
  assert.notDeepEqual(nextTurn.destination, startedOne.destination)
})

test('a crowded arrival remains summarised until the room changes and can then take a seat', () => {
  const controller = new RoomMotion()
  controller.configure(layout, {}, { width: 168, height: 242 }, 2, null, new Set(), new Set())
  const incoming = resident()
  const host = resident({ id: 8, handle: 'host', placeId: 2,
    x: layout.rooms[2]!.standing.x + 60, y: layout.rooms[2]!.standing.y + 40 })
  const arrived = controller.start(incoming, move(), { 7: incoming, 8: host })!
  assert.equal(arrived.walking, false)
  assert.equal(arrived.placeId, 2)
  assert.equal(controller.presentation(2).poses.get(7)?.visible, false)
  controller.idle({ 7: arrived, 8: host }, 16, 16, new Set())
  assert.equal(controller.presentation(2).poses.get(7)?.visible, false)
  controller.idle({ 7: arrived, 8: { ...host, placeId: 1 } }, 16, 32, new Set())
  assert.equal(controller.presentation(2).poses.has(7), false, 'the crowd allocator can try again after space is freed')
})
