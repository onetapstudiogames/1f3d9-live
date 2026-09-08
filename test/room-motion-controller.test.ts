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

test('resize replans an active walk through the new door', () => {
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
  controller.configure(layout, {}, { width: 450, height: 340 }, 1, 7, new Set(), new Set())
  current = controller.advance(current, 16)!
  assert.equal(current.walkElapsed, 16, 'recovery replans and resumes in the usable viewport')
  assert.notDeepEqual(controller.diagnostics()[0]?.door, resized.door)
})

test('a source-only walk clears at the door without reserving or walking an invisible arrival', () => {
  const controller = new RoomMotion()
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, null, new Set(), new Set())
  const started = controller.start(resident(), move(), { 7: resident() })!
  assert.equal(started.walking, true)
  const departure = controller.diagnostics()[0]!.path
  const departureMs = departure.slice(1).reduce((sum, point, index) => sum +
    Math.hypot(point.x - departure[index]!.x, point.y - departure[index]!.y), 0) / 140 * 1_000
  assert.equal(started.walkDuration, departureMs)
  assert.equal(controller.presentation(2).routes.flatMap(route => route.points).length, 0,
    'the unseen arrival reserves no route')
  const beforeExit = controller.advance(started, departureMs - 1)!
  assert.equal(beforeExit.walking, true)
  assert.equal(beforeExit.placeId, 1)
  const finished = controller.advance(beforeExit, 1)!
  assert.equal(finished.walking, false)
  assert.equal(finished.placeId, 2)
  assert.equal(finished.walkEventId, null)
  assert.equal(controller.presentation(2).poses.get(7)?.visible, false)
})

for (const condition of ['off-screen', 'hidden', 'too-small'] as const) {
  test(`a move that is ${condition} finishes immediately even when it shares a room with an active walk`, () => {
    const threeRooms = nestedLayout([
      { id: 1, parent_id: null, name: 'one' },
      { id: 2, parent_id: 1, name: 'two' },
      { id: 3, parent_id: 2, name: 'three' },
    ])
    const controller = new RoomMotion()
    controller.configure(threeRooms, {}, { width: 400, height: 320 }, 1, 7, new Set(), new Set())
    const first = controller.start(resident(), move(), { 7: resident() })!
    assert.equal(first.walking, true)
    const small = condition === 'too-small'
    controller.configure(threeRooms, {}, { width: small ? 100 : 400, height: small ? 100 : 320 },
      1, 7, new Set(condition === 'hidden' ? [2] : []), new Set())
    const next = resident({ id: 8, handle: 'eight', placeId: condition === 'off-screen' ? 2 : 1 })
    const event = { ...move('13'), actor: 'eight', detail: { ...move().detail,
      from_place_id: next.placeId!, to_place_id: condition === 'off-screen' ? 3 : 2 } }
    const finished = controller.start(next, event, { 7: first, 8: next })
    assert.ok(finished, 'an invisible move cannot wait for the displayed doorway')
    assert.equal(finished.walking, false)
    assert.equal(finished.placeId, event.detail.to_place_id)
    assert.equal(finished.lastActivityId, '13')
  })
}

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

test('sleeping residents also skip startup moves already covered by the census', () => {
  const controller = new RoomMotion()
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, null, new Set(), new Set(['12']), new Set([7]))
  // The census already includes a later return to room one.
  const current = resident({ placeId: 1 })
  assert.equal(controller.start(current, move(), { 7: current }), current)
  assert.equal(controller.presentation(1).poses.has(7), false)
})

test('sleep clears remembered seating and waking allows a fresh seat', () => {
  const controller = new RoomMotion()
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, null, new Set(), new Set())
  controller.remember({ 7: resident() }, {})
  assert.equal(controller.presentation(1).poses.has(7), true)
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, null, new Set(), new Set(), new Set([7]))
  assert.equal(controller.presentation(1).poses.has(7), false)
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, null, new Set(), new Set(), new Set())
  controller.remember({ 7: resident() }, {})
  assert.equal(controller.presentation(1).poses.get(7)?.visible, true)
})

test('sleep hides an active move from presentation, releases its route, and wakes at the destination', () => {
  const controller = new RoomMotion()
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, 7, new Set(), new Set())
  controller.remember({ 7: resident() }, {})
  const started = controller.start(resident(), move(), { 7: resident() })!
  assert.equal(started.walking, true)
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, 7, new Set(), new Set(), new Set([7]))
  const finished = controller.advance(started, 16)!
  assert.equal(finished.walking, false)
  assert.equal(finished.visible, true, 'simulation keeps the public destination drawable after waking')
  assert.equal(finished.placeId, 2)
  assert.equal(controller.presentation(2).poses.has(7), false, 'sleep alone suppresses the display figure')
  assert.equal(controller.presentation(1).routes.length, 0)
  assert.equal(controller.presentation(2).routes.length, 0)
  controller.configure(layout, {}, { width: 400, height: 320 }, 2, 7, new Set(), new Set(), new Set())
  controller.remember({ 7: finished }, {})
  assert.equal(controller.presentation(2).poses.get(7)?.visible, true)
})

test('reconfiguring an unchanged sleeper set does not churn awake poses', () => {
  const controller = new RoomMotion()
  const awake = resident({ id: 8, handle: 'eight' })
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, null, new Set(), new Set(), new Set([7]))
  controller.remember({ 7: resident(), 8: awake }, {})
  const pose = controller.presentation(1).poses.get(8)
  controller.configure(layout, {}, { width: 400, height: 320 }, 1, null, new Set(), new Set(), new Set([7]))
  assert.equal(controller.presentation(1).poses.get(8), pose)
})

test('a sleeper does not occupy an arrival target', () => {
  const empty = new RoomMotion()
  empty.configure(layout, {}, { width: 500, height: 380 }, 2, null, new Set(), new Set())
  const emptyArrival = empty.start(resident(), move(), { 7: resident() })!

  const withSleeper = new RoomMotion()
  withSleeper.configure(layout, {}, { width: 500, height: 380 }, 2, null, new Set(), new Set(), new Set([8]))
  const sleeper = resident({ id: 8, handle: 'eight', placeId: 2,
    x: layout.rooms[2]!.standing.x + layout.rooms[2]!.standing.width / 2,
    y: layout.rooms[2]!.standing.y + layout.rooms[2]!.standing.height / 2 })
  const arrival = withSleeper.start(resident(), move(), { 7: resident(), 8: sleeper })!
  assert.deepEqual(arrival.destination, emptyArrival.destination)
})
