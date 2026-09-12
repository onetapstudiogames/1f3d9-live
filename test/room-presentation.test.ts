import assert from 'node:assert/strict'
import test from 'node:test'
import { nestedLayout } from '../src/ground/nested.ts'
import { singleRoomLayout } from '../src/room-view.ts'
import { presentRoom, roomFigurePriority, roomNameLabelPriority } from '../src/room-presentation.ts'
import { ROOM_FIGURE_PITCH, ROOM_FIGURE_SIZE, ROOM_THING_PITCH } from '../src/room-crowding.ts'

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
    const leftPitch = shown[a]!.id === 4 ? ROOM_THING_PITCH : ROOM_FIGURE_PITCH
    const rightPitch = shown[b]!.id === 4 ? ROOM_THING_PITCH : ROOM_FIGURE_PITCH
    const separation = (leftPitch + rightPitch) / 2
    assert.ok(Math.abs(shown[a]!.x - shown[b]!.x) >= separation ||
      Math.abs(shown[a]!.y - shown[b]!.y) >= separation)
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

test('a speaker keeps the scarce seat when a thing is also present', () => {
  const small = singleRoomLayout(source, 112 + ROOM_FIGURE_SIZE, 186 + ROOM_FIGURE_SIZE)
  const speaker = { ...actor(2), bubble: { text: 'hello' } }
  const frame = presentRoom({ 2: speaker }, { 4: actor(4) }, world, small, new Set())

  assert.equal(frame.residents[2]!.visible, true)
  assert.equal(frame.things[4]!.visible, false)
  assert.deepEqual(frame.hiddenSpeakerIds, [])
})

test('presentation exposes reusable crowding state for unchanged unchanged frames', () => {
  const residents = Object.freeze({ 1: Object.freeze(actor(1)), 2: Object.freeze(actor(2)) })
  const first = presentRoom(residents, {}, world, target, new Set())
  const unchanged = presentRoom(residents, {}, world, target, new Set(), first.crowding)
  assert.equal(unchanged.crowding, first.crowding)
  assert.equal(unchanged.placements, first.placements)
})

test('captioned residents and used things win label collisions', () => {
  assert.ok(roomNameLabelPriority(0, true) > roomNameLabelPriority(120, false))
  assert.equal(roomNameLabelPriority(80, false), 80)
})

test('idle resident decoration cannot move an already placed thing', () => {
  const thing = { ...actor(4), x: source.standing.x + 40, y: source.standing.y + 30 }
  const first = presentRoom({ 1: actor(1) }, { 4: thing }, world, target, new Set())
  const movedResident = { ...actor(1), x: first.things[4]!.x, y: first.things[4]!.y }
  const next = presentRoom({ 1: movedResident }, { 4: thing }, world, target, new Set(), first.crowding)
  assert.deepEqual({ x: next.things[4]!.x, y: next.things[4]!.y },
    { x: first.things[4]!.x, y: first.things[4]!.y })
})

test('a followed idle step cannot move an already placed thing', () => {
  const compact = singleRoomLayout(source, 375, 540)
  const preferred = { x: compact.rooms[2]!.standing.x + 40, y: compact.rooms[2]!.standing.y + 30 }
  const resident = { ...actor(1), ...preferred }
  const thing = { ...actor(4), ...preferred }
  const first = presentRoom({ 1: resident }, { 4: thing }, compact, compact, new Set(), {}, 1)
  const moved = { ...resident, x: first.residents[1]!.x + 12, y: first.residents[1]!.y }
  const next = presentRoom({ 1: moved }, { 4: thing }, compact, compact, new Set(), first.crowding, 1)

  assert.deepEqual({ x: next.things[4]!.x, y: next.things[4]!.y },
    { x: first.things[4]!.x, y: first.things[4]!.y })
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

test('a pinned displaced thing seeds its exact normal position after action motion ends', () => {
  const things = { 4: actor(4), 5: actor(5) }
  const before = presentRoom({}, things, world, target, new Set())
  const displaced = before.things[5]!
  const projected = presentRoom({}, { 5: things[5]! }, world, target, new Set()).things[5]!
  assert.notDeepEqual({ x: displaced.x, y: displaced.y }, { x: projected.x, y: projected.y })

  const active = presentRoom({}, things, world, target, new Set(), before.crowding, null, new Map(), {
    poses: new Map(), thingPoses: new Map([[5, { ...displaced, moving: false }]]), reservations: [],
  })
  assert.notEqual(active.placements['thing:5']!.offsetX || active.placements['thing:5']!.offsetY, 0)
  const completed = presentRoom({}, things, world, target, new Set(), active.crowding)
  assert.deepEqual({ x: completed.things[5]!.x, y: completed.things[5]!.y },
    { x: displaced.x, y: displaced.y })
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

test('a 375 by 540 room spreads 23 things using their 32-pixel footprints without overlap', () => {
  const things = Object.fromEntries(Array.from({ length: 23 }, (_, index) => {
    const id = 20_000 + index
    return [id, { ...actor(id), x: source.standing.x + 20, y: source.standing.y + 20 }]
  }))
  const frame = presentRoom({}, things, world, target, new Set())
  const shown = Object.values(frame.things).filter(row => row.visible)

  assert.equal(shown.length, 23)
  for (let left = 0; left < shown.length; left += 1) for (let right = left + 1; right < shown.length; right += 1) {
    assert.ok(Math.abs(shown[left]!.x - shown[right]!.x) >= ROOM_THING_PITCH ||
      Math.abs(shown[left]!.y - shown[right]!.y) >= ROOM_THING_PITCH)
  }
})
