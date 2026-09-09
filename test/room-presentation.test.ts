import assert from 'node:assert/strict'
import test from 'node:test'
import { nestedLayout } from '../src/ground/nested.ts'
import { singleRoomLayout } from '../src/room-view.ts'
import { presentRoom, roomFigurePriority } from '../src/room-presentation.ts'
import { ROOM_FIGURE_PITCH, ROOM_FIGURE_SIZE } from '../src/room-crowding.ts'

const places = [1, 2, 3].map(id => ({ id, parent_id: id === 1 ? null : 1, name: `room ${id}`,
  quiet: id === 3, owner: null, owner_id: null, has_drawing: false }))
const world = nestedLayout(places)
const source = world.rooms[2]!
const target = singleRoomLayout(source, 375, 540)
const actor = (id: number, placeId = 2) => ({ id, placeId, x: source.standing.x + 40,
  y: source.standing.y + 30, visible: true, walking: false, bubble: null })

test('room presentation shares separated screen positions across figures, things and their cues', () => {
  const residents = Object.freeze({ 1: Object.freeze(actor(1)), 2: Object.freeze(actor(2)), 3: actor(3, 1) })
  const things = Object.freeze({ 4: Object.freeze(actor(4)) })
  const result = presentRoom(residents, things, world, target, new Set())
  const shown = [...Object.values(result.residents), ...Object.values(result.things)].filter(row => row.visible)
  assert.equal(shown.length, 3)
  for (const row of shown) {
    assert.ok(row.x >= target.rooms[2]!.standing.x && row.x <= 375)
    assert.ok(row.y >= target.rooms[2]!.standing.y && row.y <= 540)
    assert.deepEqual({ x: row.x, y: row.y }, {
      x: result.placements[`${row.id === 4 ? 'thing' : 'resident'}:${row.id}`]!.x,
      y: result.placements[`${row.id === 4 ? 'thing' : 'resident'}:${row.id}`]!.y })
  }
  for (let a = 0; a < shown.length; a++) for (let b = a + 1; b < shown.length; b++) {
    assert.ok(Math.abs(shown[a]!.x - shown[b]!.x) >= ROOM_FIGURE_PITCH ||
      Math.abs(shown[a]!.y - shown[b]!.y) >= ROOM_FIGURE_PITCH)
  }
  assert.equal(result.residents[3]!.visible, false)
  assert.equal(residents[1].x, source.standing.x + 40)
  const next = presentRoom(residents, things, world, target, new Set(), result.placements)
  assert.deepEqual(next.residents, result.residents)
  assert.deepEqual(next.things, result.things)
  assert.deepEqual(next.placements, result.placements)
})

test('speakers outrank idle followed residents and hidden speakers are reported', () => {
  const idleFollowed = actor(1)
  const speaker = { ...actor(2), bubble: { text: 'hello' } }
  assert.ok(roomFigurePriority(speaker, 1) > roomFigurePriority(idleFollowed, 1))
  assert.ok(roomFigurePriority({ ...speaker, id: 1 }, 1) > roomFigurePriority(speaker, null))

  const small = singleRoomLayout(source, 112 + ROOM_FIGURE_SIZE, 186 + ROOM_FIGURE_SIZE)
  const one = presentRoom({ 1: idleFollowed, 2: speaker }, {}, world, small, new Set(), {}, 1)
  assert.equal(one.residents[2]!.visible, true)
  assert.equal(one.residents[1]!.visible, false)
  const twoSpeakers = presentRoom({ 1: { ...idleFollowed, bubble: {} }, 2: speaker }, {}, world, small, new Set())
  assert.deepEqual(twoSpeakers.hiddenSpeakerIds, [2])
})

test('presentation exposes reusable crowding state for unchanged unchanged frames', () => {
  const residents = Object.freeze({ 1: Object.freeze(actor(1)), 2: Object.freeze(actor(2)) })
  const first = presentRoom(residents, {}, world, target, new Set())
  const unchanged = presentRoom(residents, {}, world, target, new Set(), first.crowding)
  assert.equal(unchanged.crowding, first.crowding)
  assert.equal(unchanged.placements, first.placements)
})

test('quiet, unavailable and hidden rooms cannot expose projected occupants or anchors', () => {
  const residents = { 1: actor(1), 2: actor(2, 3) }
  for (const display of [undefined, singleRoomLayout(world.rooms[3]!, 375, 540), target]) {
    const frame = presentRoom(residents, {}, world, display, new Set([2]))
    assert.ok(Object.values(frame.residents).every(row => !row.visible))
    assert.deepEqual(frame.placements, {})
  }
})

test('following wins scarce standing space and agreement positions use the same projection', () => {
  const small = singleRoomLayout(source, 112 + ROOM_FIGURE_SIZE, 186 + ROOM_FIGURE_SIZE)
  const residents = { 1: actor(1), 2: actor(2) }
  const frame = presentRoom(residents, {}, world, small, new Set(), {}, 2)
  assert.equal(frame.residents[2]!.visible, true)
  assert.equal(frame.residents[1]!.visible, false)
  const overridden = presentRoom({ 1: actor(1) }, {}, world, target, new Set(), {}, null,
    new Map([[1, { x: source.standing.x + 70, y: source.standing.y + 40 }]]))
  const ordinary = presentRoom({ 1: actor(1) }, {}, world, target, new Set())
  assert.notDeepEqual(overridden.residents[1], ordinary.residents[1])
})

test('a screen walk passes the standing band without being snapped into a seat', () => {
  const pose = { x: 24, y: 220, placeId: 2, visible: true, moving: true }
  const frame = presentRoom({ 1: { ...actor(1), walking: true }, 2: actor(2) }, {}, world,
    target, new Set(), {}, null, new Map(), { poses: new Map([[1, pose]]), reservations: [] })
  assert.equal(frame.residents[1]!.x, 24)
  assert.equal(frame.residents[1]!.y, 220)
  assert.equal(frame.residents[1]!.visible, true)
  assert.equal(frame.residents[2]!.visible, true)
  assert.equal(frame.placements['resident:1'], undefined)
})

test('idle screen poses remain continuous and a reserved walk target stays free', () => {
  const idle = { x: 200, y: 200, placeId: 2, visible: true, moving: false }
  const reservation = { x: 70, y: 120, width: ROOM_FIGURE_PITCH, height: ROOM_FIGURE_PITCH }
  const frame = presentRoom({ 1: actor(1), 2: actor(2) }, {}, world, target,
    new Set(), {}, null, new Map(), { poses: new Map([[1, idle]]), reservations: [reservation] })
  assert.equal(frame.residents[1]!.x, 200)
  assert.equal(frame.residents[1]!.y, 200)
  const other = frame.residents[2]!
  assert.ok(!other.visible || Math.abs(other.x - 100) >= ROOM_FIGURE_PITCH || Math.abs(other.y - 150) >= ROOM_FIGURE_PITCH)
})

test('screen poses cannot expose a quiet room or hide its public speaker for lack of a prior seat', () => {
  const motion = { poses: new Map([[1, { x: 10, y: 20, placeId: 2, visible: false, moving: false }]]), reservations: [] }
  const speaker = { ...actor(1), bubble: { text: 'recorded words' } }
  const frame = presentRoom({ 1: speaker }, {}, world, target, new Set(), {}, null, new Map(), motion)
  assert.equal(frame.residents[1]!.visible, true)
  const hidden = presentRoom({ 1: speaker }, {}, world, target, new Set([2]), {}, null, new Map(), motion)
  assert.equal(hidden.residents[1]!.visible, false)
})

test('a sleeper is excluded before motion, crowding, and hidden-speaker fallback', () => {
  const speaker = { ...actor(1), bubble: { text: 'old words' } }
  const motion = { poses: new Map([[1, { x: 10, y: 20, placeId: 2, visible: true, moving: true }]]), reservations: [] }
  const frame = presentRoom({ 1: speaker, 2: actor(2) }, {}, world, target, new Set(), {}, null,
    new Map(), motion, new Set([1]))
  assert.equal(frame.residents[1]!.visible, false)
  assert.equal(frame.placements['resident:1'], undefined)
  assert.deepEqual(frame.hiddenSpeakerIds, [])
  assert.equal(frame.residents[2]!.visible, true)
})
