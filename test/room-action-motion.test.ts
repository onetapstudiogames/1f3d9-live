import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayEvent } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import type { ResidentState } from '../src/replay/simulation.ts'
import { RoomMotion } from '../src/scenes/RoomMotion.ts'
import { presentRoom } from '../src/room-presentation.ts'
import { singleRoomLayout } from '../src/room-view.ts'
import { projectRoomPoint } from '../src/room-view.ts'

const layout = nestedLayout([{ id: 1, parent_id: null, name: 'one' }])
const resident = (overrides: Partial<ResidentState> = {}): ResidentState => ({ id: 7, handle: 'seven', joinedAt: null,
  sparkle: null, placeId: 1, x: 80, y: 100, flipX: false, walking: false, visible: true, bubble: null, queue: [],
  path: [], walkElapsed: 0, walkDuration: 0, destinationId: null, destination: null, walkEventId: null,
  transferUntil: null, actionUntil: null, actionEvent: null, ...overrides })
const event = (id = '30', thingId = 9): ReplayEvent => ({ actor: 'seven', at: '2026-01-01T00:00:00Z',
  change_id: id, event_id: Number(id), kind: 'action', detail: { action: 'use', status: 'applied', source_thing_id: thingId,
    place_id: 1 } })
const thing = (id = 9, visible = true) => ({ id, placeId: 1, x: 280, y: 100, visible })
const configured = (things: Readonly<Record<number, ReturnType<typeof thing>>> = { 9: thing() }, sleepers = new Set<number>()) => {
  const controller = new RoomMotion()
  controller.configure(layout, things, { width: 500, height: 380 }, 1, null, new Set(), sleepers)
  controller.remember({ 7: resident() }, things)
  return controller
}

test('visible applied use approaches, shakes both sprites, then remains beside the thing idle', () => {
  const controller = configured()
  let row = controller.startAction(resident(), event(), { 7: resident() }, 1_000)!
  assert.equal(row.walking, true)
  assert.equal(row.actionEvent?.change_id, '30')
  const duration = row.actionUntil! - 1_000
  row = controller.advanceAction(row, duration - 500, 1_000 + duration - 500)!
  const frame = controller.actionFrames()[0]!
  assert.equal(frame.phase, 'shake')
  assert.equal(frame.residentId, 7)
  assert.equal(frame.thingId, 9)
  assert.equal(row.walking, false)
  assert.equal(frame.offsetX !== 0, true)
  row = controller.advanceAction(row, 500, 1_000 + duration)!
  assert.equal(row.actionUntil, null)
  assert.equal(row.actionEvent, null)
  assert.equal(row.walking, false)
  assert.equal(controller.presentation(1).poses.get(7)?.moving, false)
})

test('a reserved target queues retry and prevents stacking', () => {
  const controller = configured()
  const one = controller.startAction(resident(), event('30'), { 7: resident() }, 0)!
  const other = resident({ id: 8, handle: 'eight', x: 90 })
  assert.equal(controller.startAction(other, { ...event('31'), actor: 'eight' }, { 7: one, 8: other }, 0), null)
})

test('hidden, missing, off-room, sleeping, and non-applied targets skip without walking', () => {
  assert.equal(configured({ 9: thing(9, false) }).startAction(resident(), event(), { 7: resident() }, 0), undefined)
  assert.equal(configured({}).startAction(resident(), event(), { 7: resident() }, 0), undefined)
  assert.equal(configured({ 9: { ...thing(), placeId: 2 } }).startAction(resident(), event(), { 7: resident() }, 0), undefined)
  assert.equal(configured(undefined, new Set([7])).startAction(resident(), event(), { 7: resident() }, 0), undefined)
  assert.equal(configured().startAction(resident(), { ...event(), detail: { ...event().detail, status: 'failed' } }, { 7: resident() }, 0), undefined)
})

test('a witnessed noop use still performs its recorded visible interaction', () => {
  const controller = configured()
  const started = controller.startAction(resident(), { ...event(), detail: { ...event().detail, status: 'noop' } },
    { 7: resident() }, 0)
  assert.equal(started?.walking, true)
})

test('target disappearance, room reset, and sleep cancel to safe idle', () => {
  for (const mode of ['target', 'room', 'sleep'] as const) {
    const controller = configured()
    const started = controller.startAction(resident(), event(), { 7: resident() }, 0)!
    if (mode === 'target') controller.configure(layout, {}, { width: 500, height: 380 }, 1, null, new Set(), new Set())
    if (mode === 'room') controller.configure(layout, { 9: thing() }, { width: 500, height: 380 }, null, null, new Set(), new Set())
    if (mode === 'sleep') controller.configure(layout, { 9: thing() }, { width: 500, height: 380 }, 1, null, new Set(), new Set([7]))
    const cancelled = controller.advanceAction(started, 16, 16)!
    assert.equal(cancelled.actionUntil, null)
    assert.equal(cancelled.actionEvent, null)
    assert.equal(cancelled.walking, false)
  }
})

test('sleep hides every action frame and reservation before the next advance clears state', () => {
  const controller = configured()
  const started = controller.startAction(resident(), event(), { 7: resident() }, 0)!
  controller.configure(layout, { 9: thing() }, { width: 500, height: 380 }, 1, null, new Set(), new Set([7]))
  assert.deepEqual(controller.actionFrames(), [])
  const frame = controller.presentation(1)
  assert.equal(frame.thingPoses?.size, 0)
  assert.equal(frame.pinnedResidentIds?.size, 0)
  assert.equal(frame.routes.length, 0)
  const cleared = controller.advanceAction(started, 16, 16)!
  assert.equal(cleared.actionUntil, null)
})

test('resize cancels an active action cleanly instead of retaining stale screen coordinates', () => {
  const controller = configured()
  const started = controller.startAction(resident(), event(), { 7: resident() }, 0)!
  controller.configure(layout, { 9: thing() }, { width: 600, height: 420 }, 1, null, new Set(), new Set())
  const cancelled = controller.advanceAction(started, 16, 16)!
  assert.equal(cancelled.actionUntil, null)
  assert.equal(controller.actionFrames().length, 0)
})

test('an action starts only from currently remembered visible actor and thing poses', () => {
  const controller = new RoomMotion()
  controller.configure(layout, { 9: thing() }, { width: 500, height: 380 }, 1, null, new Set(), new Set())
  assert.equal(controller.startAction(resident(), event(), { 7: resident() }, 0), undefined)
})

test('active action presentation reserves the pinned thing and shake destination footprints', () => {
  const controller = configured()
  let started = controller.startAction(resident(), event(), { 7: resident() }, 0)!
  const approach = controller.presentation(1)
  assert.equal(approach.reservations.length >= 2, true)
  started = controller.advanceAction(started, started.walkDuration, started.walkDuration)!
  assert.equal(started.walking, false)
  assert.equal(controller.presentation(1).reservations.length >= 2, true)
})

test('idle motion stays held throughout the action shake', () => {
  const controller = configured()
  let row = controller.startAction(resident(), event(), { 7: resident() }, 0)!
  row = controller.advanceAction(row, row.walkDuration, row.walkDuration)!
  const before = controller.presentation(1).poses.get(7)
  controller.idle({ 7: row }, 16, 20_000, new Set())
  assert.deepEqual(controller.presentation(1).poses.get(7), before)
  assert.equal(controller.actionFrames()[0]?.phase, 'shake')
})

test('remembering a currently hidden entity removes its stale action origin or target', () => {
  const hiddenActor = configured()
  hiddenActor.remember({ 7: { ...resident(), visible: false } }, { 9: thing() })
  assert.equal(hiddenActor.startAction(resident(), event(), { 7: resident() }, 0), undefined)

  const hiddenThing = configured()
  hiddenThing.remember({ 7: resident() }, { 9: thing(9, false) })
  assert.equal(hiddenThing.startAction(resident(), event(), { 7: resident() }, 0), undefined)
})

test('missing or different recorded room proof cannot animate shown-room cached poses', () => {
  const controller = configured()
  const missing = { ...event(), detail: { ...event().detail, place_id: undefined } }
  const different = { ...event(), detail: { ...event().detail, place_id: 3 } }
  assert.equal(controller.startAction(resident(), missing, { 7: resident() }, 0), undefined)
  assert.equal(controller.startAction(resident(), different, { 7: resident() }, 0), undefined)
})

test('cached poses from another room cannot start a shown-room action', () => {
  const actor = configured()
  actor.remember({ 7: { ...resident(), placeId: 2 } }, { 9: thing() })
  assert.equal(actor.startAction(resident(), event(), { 7: resident() }, 0), undefined)

  const target = configured()
  target.remember({ 7: resident() }, { 9: { ...thing(), placeId: 2 } })
  assert.equal(target.startAction(resident(), event(), { 7: resident() }, 0), undefined)
})

test('active action routes remain published as clearance reservations', () => {
  const controller = configured()
  controller.startAction(resident(), event(), { 7: resident() }, 0)
  const frame = controller.presentation(1)
  assert.equal(frame.routes.some(route => route.points.length > 1), true)
  assert.equal(frame.reservations.length >= 2, true)
})

test('the production presentation keeps a completed actor beside its edge target', () => {
  const display = singleRoomLayout(layout.rooms[1]!, 500, 380)
  const edgeThing = { id: 9, placeId: 1, x: display.rooms[1]!.standing.x + 16,
    y: display.rooms[1]!.standing.y + 16, visible: true }
  const worldPoint = projectRoomPoint(edgeThing, display.rooms[1]!, layout.rooms[1]!)!
  const worldThing = { ...edgeThing, ...worldPoint }
  const controller = configured({ 9: worldThing })
  const actor = resident({ x: display.rooms[1]!.standing.x + display.rooms[1]!.standing.width / 2,
    y: display.rooms[1]!.standing.y + display.rooms[1]!.standing.height / 2 })
  controller.remember({ 7: actor }, { 9: edgeThing })
  let row = controller.startAction(actor, event(), { 7: actor }, 0)!
  const activeFrame = presentRoom({ 7: row }, { 9: worldThing }, layout, display, new Set(), {}, null, new Map(),
    controller.presentation(1))
  row = controller.advanceAction(row, row.actionUntil!, row.actionUntil!)!
  const frame = presentRoom({ 7: row }, { 9: worldThing }, layout, display, new Set(), activeFrame.crowding, null, new Map(),
    controller.presentation(1))
  assert.equal(frame.residents[7]!.visible, true)
  assert.equal(frame.things[9]!.visible, true)
  assert.equal(Math.hypot(frame.residents[7]!.x - frame.things[9]!.x,
    frame.residents[7]!.y - frame.things[9]!.y) <= 64, true,
  JSON.stringify({ resident: frame.residents[7], thing: frame.things[9], motion: controller.presentation(1) }))
})

test('completion releases action pins and a consumed target leaves no ghost reservation', () => {
  const controller = configured()
  let row = controller.startAction(resident(), { ...event(), detail: { ...event().detail, action: 'consume' } },
    { 7: resident() }, 0)!
  row = controller.advanceAction(row, row.actionUntil!, row.actionUntil!)!
  controller.configure(layout, {}, { width: 500, height: 380 }, 1, null, new Set(), new Set())
  const frame = controller.presentation(1)
  assert.equal(frame.thingPoses?.size, 0)
  assert.equal(frame.pinnedResidentIds?.size, 0)
  assert.equal(frame.reservations.length, 0)
})

test('completion returns the resident to normal idle and speaker priority', () => {
  const controller = configured()
  let row = controller.startAction(resident(), event(), { 7: resident() }, 0)!
  row = controller.advanceAction(row, row.actionUntil!, row.actionUntil!)!
  const frame = controller.presentation(1)
  assert.equal(frame.pinnedResidentIds?.has(7), false)
  controller.idle({ 7: { ...row, bubble: { noteId: 1 } as never } }, 16, 20_000, new Set())
  assert.equal(controller.presentation(1).pinnedResidentIds?.has(7), false)
})
