import assert from 'node:assert/strict'
import test from 'node:test'
import type { CueFrame } from '../src/activity-cues.ts'
import type { NestedLayout, Room } from '../src/ground/nested.ts'
import type { HandoverState, HandoverStep } from '../src/handovers.ts'
import type { ResidentState } from '../src/replay/simulation.ts'
import { transferDuration } from '../src/giving.ts'
import { projectCueAnchors, projectRoomHandovers, roomAnchorPair, visibleFigureMidpoint } from '../src/room-anchors.ts'

const room = (id: number, x: number, y: number): Room => ({ id, parentId: 1, name: `room ${id}`, quiet: false, depth: 1,
  x, y, width: 240, height: 170, door: { x: x + 120, y: y + 170 },
  standing: { x: x + 24, y: y + 24, width: 192, height: 90 }, children: [] })
const cue = (roomId: number, x: number, y: number): CueFrame => ({ key: 'cue', cue: 'note', residentId: null, thingId: null,
  roomId, anchor: { x, y, roomId }, cells: [], alpha: 1 })
const resident = (id: number, handle: string, placeId: number, x: number, y: number, visible = true): ResidentState => ({
  id, handle, joinedAt: null, sparkle: null, placeId, x, y, flipX: false, walking: false, visible, bubble: null, queue: [],
  path: [], walkElapsed: 0, walkDuration: 0, destinationId: null, destination: null, walkEventId: null, transferUntil: null,
})

test('projects only explicit anchors from the selected source room without mutating frames', () => {
  const source = room(2, 800, 500); const target = room(2, 20, 30)
  const selected = cue(2, 848, 548); const other = cue(3, 900, 600); const entity = { ...cue(2, 0, 0), anchor: null }
  const frames = Object.freeze([selected, other, entity])
  const projected = projectCueAnchors(frames, source, target)
  assert.deepEqual(projected[0]?.anchor, { x: 68, y: 78, roomId: 2 })
  assert.equal(projected[1], other); assert.equal(projected[2], entity)
  assert.deepEqual(selected.anchor, { x: 848, y: 548, roomId: 2 })
})

test('room anchor pairs require the selected public room in both current layouts', () => {
  const sourceRoom = Object.freeze({ ...room(2, 800, 500), parentId: null })
  const targetRoom = Object.freeze({ ...room(2, 8, 8), parentId: null })
  const source = layout(sourceRoom); const display = layout(targetRoom)
  assert.deepEqual(roomAnchorPair(source, display, 2), { source: sourceRoom, target: targetRoom })
  assert.equal(roomAnchorPair(undefined, display, 2), undefined)
  assert.equal(roomAnchorPair(source, undefined, 2), undefined)
  assert.equal(roomAnchorPair(source, display, null), undefined)
  assert.equal(roomAnchorPair(layout(Object.freeze({ ...sourceRoom, id: 3 })), display, 2), undefined)
  assert.equal(roomAnchorPair(source, layout(Object.freeze({ ...targetRoom, id: 3 })), 2), undefined)
  assert.equal(roomAnchorPair(layout(Object.freeze({ ...sourceRoom, quiet: true })), display, 2), undefined)
  assert.equal(roomAnchorPair(source, layout(Object.freeze({ ...targetRoom, quiet: true })), 2), undefined)
})

test('handover carry follows the visible projected carrier and hides an off-room carrier', () => {
  const state = handoverState('gift')
  const frame = handoverFrame(state, [{ key: 'carry:notice', thingId: 9, x: 900, y: 900, visible: true, alpha: 1 }])
  const visible = projectRoomHandovers(frame, state, { 1: resident(1, 'giver', 2, 80, 100) }, 100)
  assert.deepEqual(visible.motions[0], { key: 'carry:notice', thingId: 9, x: 80, y: 88, visible: true, alpha: 1 })
  assert.equal(projectRoomHandovers(frame, state, { 1: resident(1, 'giver', 2, 80, 100, false) }, 100).motions.length, 0)
  assert.equal(frame.motions[0]?.x, 900)
})

test('handover floats recompute from projected figures and hearts belong only to gifts', () => {
  for (const mode of ['gift', 'effect'] as const) {
    const state = handoverState(mode)
    const frame = handoverFrame(state, [{ key: 'transfer:transfer', thingId: 9, x: 900, y: 900, visible: true,
      alpha: 0.4, heart: { x: 1, y: 1 } }])
    const residents = { 1: resident(1, 'giver', 2, 40, 100), 2: resident(2, 'receiver', 2, 140, 100) }
    const motion = projectRoomHandovers(frame, state, residents, transferDuration() / 2).motions[0]!
    assert.equal(motion.x, 90); assert.equal(motion.y, 68)
    assert.equal('heart' in motion, mode === 'gift')
    assert.equal(frame.motions[0]?.x, 900)
    assert.equal(projectRoomHandovers(frame, state, { ...residents, 2: resident(2, 'receiver', 3, 140, 100) }, 600).motions.length, 0)
  }
})

test('agreement midpoint uses the visible figure sprites', () => {
  assert.deepEqual(visibleFigureMidpoint({ x: 30, y: 50, visible: true }, { x: 90, y: 70, visible: true }), { x: 60, y: 60 })
  assert.equal(visibleFigureMidpoint({ x: 30, y: 50, visible: false }, { x: 90, y: 70, visible: true }), null)
})

function handoverState(mode: 'gift' | 'effect'): HandoverState {
  const plan = { thingId: 9, actor: 'giver', carrierId: 1, actionId: 4, fromId: 1, toId: 2,
    noticeChangeId: 'notice', actionChangeId: 'action' }
  return { carries: [plan], held: [{ plan, rows: [], actionSeen: true }], floats: [{ transfer: { thingId: 9, actor: 'giver',
    mode, partnerId: 2, placeId: 2 }, changeId: 'transfer', partners: { from: { x: 800, y: 800 }, to: { x: 900, y: 900 } },
    startedAt: 0 }], seenActions: [] }
}

function handoverFrame(state: HandoverState, motions: HandoverStep['motions']): HandoverStep {
  return { state, floorEvents: [], motions, carryThingIds: [9], pending: true }
}

function layout(value: Room): NestedLayout {
  return Object.freeze({ rooms: Object.freeze({ [value.id]: value }), rootId: value.id, width: value.width, height: value.height })
}
