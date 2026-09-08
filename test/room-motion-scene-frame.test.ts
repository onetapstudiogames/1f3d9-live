import assert from 'node:assert/strict'
import test from 'node:test'

import type { ReplayEvent } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { presentRoom } from '../src/room-presentation.ts'
import { singleRoomLayout } from '../src/room-view.ts'
import type { RoomCrowdingState } from '../src/room-crowding.ts'
import { stepResidents, type ResidentState, type Simulation } from '../src/replay/simulation.ts'
import { RoomMotion } from '../src/scenes/RoomMotion.ts'

const layout = nestedLayout([
  { id: 1, parent_id: null, name: 'arrival room' },
  { id: 2, parent_id: 1, name: 'source room' },
], { 1: 4, 2: 4 })
const viewport = Object.freeze({ width: 500, height: 380 })

const resident = (id: number, handle: string, placeId: number): ResidentState => {
  const room = layout.rooms[placeId]!
  return Object.freeze({
    id, handle, joinedAt: null, sparkle: null, placeId,
    x: room.standing.x + room.standing.width / 2,
    y: room.standing.y + room.standing.height / 2,
    flipX: false, walking: false, visible: true, bubble: null, queue: [], path: [], walkElapsed: 0,
    walkDuration: 0, destinationId: null, destination: null, walkEventId: null, transferUntil: null,
  })
}

const simulation = (...rows: readonly ResidentState[]): Simulation => Object.freeze({
  residents: Object.freeze(Object.fromEntries(rows.map(row => [row.id, row]))),
  actors: new Map(rows.map(row => [row.handle, row.id])), pending: false, issues: Object.freeze([]),
  reservations: Object.freeze({}), startedTransfers: Object.freeze([]),
})

const move = (actor: string, id: string, fromId = 2, toId = 1): ReplayEvent => Object.freeze({
  actor, at: '2026-01-01T00:00:00Z', change_id: id, event_id: Number(id), kind: 'action',
  detail: Object.freeze({ action: 'move', status: 'applied', from_place_id: fromId, to_place_id: toId }),
})

const renderCycle = (
  controller: RoomMotion,
  state: Simulation,
  roomId: number,
  previous: RoomCrowdingState | undefined = undefined,
) => {
  const display = singleRoomLayout(layout.rooms[roomId]!, viewport.width, viewport.height)
  controller.configure(layout, {}, viewport, roomId, null, new Set(), new Set())
  const frame = presentRoom(state.residents, {}, layout, display, new Set(
    Object.keys(layout.rooms).map(Number).filter(id => id !== roomId),
  ), previous, null, new Map(), controller.presentation(roomId))
  controller.remember(frame.residents, frame.things)
  return frame
}

const step = (controller: RoomMotion, state: Simulation, events: readonly ReplayEvent[], elapsed: number, now: number) =>
  stepResidents(state, events, elapsed, now, layout, 1, new Map(), undefined, {
    startMove: (row, event, all) => controller.start(row, event, all),
    advanceMove: (row, delta) => controller.advance(row, delta),
  })

const separated = (left: Readonly<{ x: number; y: number }>, right: Readonly<{ x: number; y: number }>): boolean =>
  Math.abs(left.x - right.x) >= 60 || Math.abs(left.y - right.y) >= 60

test('stationary production frames reuse the same placements on consecutive render cycles', () => {
  const controller = new RoomMotion()
  const state = simulation(resident(1, 'one', 1), resident(2, 'two', 1))
  const first = renderCycle(controller, state, 1)
  const second = renderCycle(controller, state, 1, first.crowding)
  const third = renderCycle(controller, state, 1, second.crowding)

  assert.deepEqual(Object.values(second.residents).map(row => [row.id, row.x, row.y, row.visible]),
    Object.values(first.residents).map(row => [row.id, row.x, row.y, row.visible]))
  assert.deepEqual(Object.values(third.residents).map(row => [row.id, row.x, row.y, row.visible]),
    Object.values(second.residents).map(row => [row.id, row.x, row.y, row.visible]))
  assert.equal(third.placements, second.placements)
})

test('idle motion stays continuous through render cycles without changing recorded coordinates', () => {
  const controller = new RoomMotion()
  const original = resident(1, 'one', 1)
  const state = simulation(original)
  const seated = renderCycle(controller, state, 1)

  controller.idle(state.residents, 0, 0, new Set())
  controller.idle(state.residents, 16, 12_000, new Set())
  const started = renderCycle(controller, state, 1, seated.crowding)
  controller.idle(state.residents, 100, 12_100, new Set())
  const advanced = renderCycle(controller, state, 1, started.crowding)

  assert.equal(controller.presentation(1).poses.get(1)?.moving, true)
  assert.notDeepEqual({ x: advanced.residents[1]!.x, y: advanced.residents[1]!.y },
    { x: started.residents[1]!.x, y: started.residents[1]!.y })
  assert.equal(state.residents[1]!.x, original.x)
  assert.equal(state.residents[1]!.y, original.y)
})

test('a recorded walk keeps a seated neighbour fixed and clear throughout production frames', () => {
  const controller = new RoomMotion()
  const walker = resident(1, 'walker', 2)
  const neighbour = resident(2, 'neighbour', 2)
  let state = simulation(walker, neighbour)
  const before = renderCycle(controller, state, 2)
  const neighbourBefore = before.residents[2]!

  state = step(controller, state, [move('walker', '101')], 0, 0)
  for (let index = 0; index < 30 && state.residents[1]!.placeId === 2; index += 1) {
    const frame = renderCycle(controller, state, 2, before.crowding)
    const shownWalker = frame.residents[1]!
    const shownNeighbour = frame.residents[2]!
    assert.deepEqual({ x: shownNeighbour.x, y: shownNeighbour.y, visible: shownNeighbour.visible },
      { x: neighbourBefore.x, y: neighbourBefore.y, visible: neighbourBefore.visible })
    if (shownWalker.visible && shownNeighbour.visible) assert.equal(separated(shownWalker, shownNeighbour), true)
    state = step(controller, state, [], 16, index * 16 + 16)
  }
})

test('an arrival target respects a destination resident already drawn by the production cycle', () => {
  const controller = new RoomMotion()
  const arriving = resident(1, 'arriving', 2)
  const neighbour = resident(2, 'neighbour', 1)
  let state = simulation(arriving, neighbour)
  const before = renderCycle(controller, state, 1)
  const neighbourBefore = before.residents[2]!

  state = step(controller, state, [move('arriving', '102')], 0, 0)
  let frame = renderCycle(controller, state, 1, before.crowding)
  for (let index = 0; index < 200 && state.residents[1]!.walking; index += 1) {
    state = step(controller, state, [], 32, index * 32 + 32)
    frame = renderCycle(controller, state, 1, frame.crowding)
  }

  assert.equal(state.residents[1]!.walking, false)
  assert.equal(frame.residents[1]!.visible, true)
  assert.deepEqual({ x: frame.residents[2]!.x, y: frame.residents[2]!.y },
    { x: neighbourBefore.x, y: neighbourBefore.y })
  assert.equal(separated(frame.residents[1]!, frame.residents[2]!), true)
})
