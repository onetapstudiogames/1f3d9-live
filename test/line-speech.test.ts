import assert from 'node:assert/strict'
import test from 'node:test'

import type { ReplayEvent, Resident } from '../src/city/types.ts'
import { nestedLayout, type NestedLayout } from '../src/ground/nested.ts'
import { createPresentResidents, type Simulation } from '../src/replay/simulation.ts'
import { bubbleFor } from '../src/speech.ts'
import { withLineBubble } from '../src/line-speech.ts'

const people: readonly Resident[] = [
  { id: 7, handle: 'ada', current_place_id: 2, model: '', joined_at: '', has_drawing: false, asleep: false },
  { id: 8, handle: 'bea', current_place_id: 3, model: '', joined_at: '', has_drawing: false, asleep: false },
  { id: 9, handle: 'sleeper', current_place_id: 2, model: '', joined_at: '', has_drawing: false, asleep: true },
]
const layout = nestedLayout([
  { id: 1, parent_id: null, name: 'world' },
  { id: 2, parent_id: 1, name: 'room' },
  { id: 3, parent_id: 1, name: 'other room' },
  { id: 4, parent_id: 1, name: 'quiet room', quiet: true },
], { 1: 4, 2: 4, 3: 4, 4: 4 })
const makeState = (ground: NestedLayout = layout): Simulation => createPresentResidents(people, ground)
const line = (actor = 'ada', placeId = 2, kind = 'line_said', body = 'A public line.'): ReplayEvent => ({
  actor, at: '2026-01-01T00:00:00Z', change_id: '10', event_id: 901, kind,
  detail: { line_id: 901, place_id: placeId }, line: body,
})
const updateResident = (state: Simulation, id: number, patch: Record<string, unknown>): Simulation => ({
  ...state, residents: { ...state.residents, [id]: { ...state.residents[id]!, ...patch } },
})

test('an awake speaker already in the public room gets the line card without moving', () => {
  const state = makeState()
  const before = state.residents[7]!
  const result = withLineBubble(state, line(), 123, 2, new Set(), layout)
  assert.equal(result.shown, true)
  assert.equal(result.relocated, false)
  assert.notEqual(result.state, state)
  assert.equal(result.state.residents[7]!.placeId, 2)
  assert.equal(result.state.residents[7]!.x, before.x)
  assert.equal(result.state.residents[7]!.y, before.y)
  assert.equal(result.state.residents[7]!.bubble?.size, 'line')
  assert.deepEqual(state.residents[7], before)
})

test('a standing speaker in another room is placed with the card', () => {
  const state = makeState()
  const result = withLineBubble(state, line('bea'), 456, 2, new Set(), layout)
  assert.equal(result.shown, true)
  assert.equal(result.relocated, true)
  assert.equal(result.state.residents[8]!.placeId, 2)
  assert.equal(result.state.residents[8]!.relocatedAt, 456)
  assert.equal(result.state.residents[8]!.visible, true)
  assert.equal(result.state.residents[8]!.bubble?.lineId, 901)
})

test('a line can place a speaker with no current room', () => {
  const state = updateResident(makeState(), 8, { placeId: null, visible: false })
  const result = withLineBubble(state, line('bea'), 789, 2, new Set(), layout)
  assert.equal(result.shown, true)
  assert.equal(result.relocated, true)
  assert.equal(result.state.residents[8]!.placeId, 2)
})

test('a line naming another room is not shown for the selected room', () => {
  const state = makeState()
  const result = withLineBubble(state, line('ada', 3), 123, 2, new Set(), layout)
  assert.equal(result.shown, false)
  assert.equal(result.state, state)
})

test('quiet rooms do not show line cards', () => {
  const state = makeState()
  const result = withLineBubble(state, line('ada', 4), 123, 4, new Set(), layout)
  assert.equal(result.shown, false)
  assert.equal(result.state, state)
})

test('sleepers do not show line cards', () => {
  const state = makeState()
  const result = withLineBubble(state, line('sleeper'), 123, 2, new Set([9]), layout)
  assert.equal(result.shown, false)
  assert.equal(result.state, state)
})

test('walking speakers and speakers with queued work do not get moved or shown', () => {
  const state = makeState()
  const walking = updateResident(state, 8, { walking: true, destinationId: 2 })
  const walkingResult = withLineBubble(walking, line('bea'), 123, 2, new Set(), layout)
  assert.equal(walkingResult.shown, false)
  assert.equal(walkingResult.state, walking)
  const queued = updateResident(state, 8, { queue: [{ event: line('bea', 3, 'note') }] })
  const queuedResult = withLineBubble(queued, line('bea'), 123, 2, new Set(), layout)
  assert.equal(queuedResult.shown, false)
  assert.equal(queuedResult.state, queued)
})

test('unknown actors and note events do not show a line card', () => {
  const state = makeState()
  assert.equal(withLineBubble(state, line('ghost'), 123, 2, new Set(), layout).shown, false)
  assert.equal(withLineBubble(state, line('ada', 2, 'note'), 123, 2, new Set(), layout).shown, false)
})

test('a line replaces the speaker note bubble without changing the input state', () => {
  const initial = makeState()
  const note = bubbleFor({ ...line('ada', 2, 'note'), detail: { note_id: 45, place_id: 2 } }, 100)!
  const state = updateResident(initial, 7, { bubble: note })
  const before = state.residents[7]!
  const result = withLineBubble(state, line(), 123, 2, new Set(), layout)
  assert.equal(result.shown, true)
  assert.equal(result.state.residents[7]!.bubble?.size, 'line')
  assert.equal(result.state.residents[7]!.bubble?.lineId, 901)
  assert.deepEqual(state.residents[7], before)
})

test('no free room spot leaves the speaker and input state alone', () => {
  const state = makeState()
  const cramped = { ...layout, rooms: { ...layout.rooms, 2: { ...layout.rooms[2]!, standing: { x: 0, y: 0, width: 1, height: 1 } } } } as NestedLayout
  const result = withLineBubble(state, line('bea'), 123, 2, new Set(), cramped)
  assert.equal(result.shown, false)
  assert.equal(result.relocated, false)
  assert.equal(result.state, state)
  assert.equal(state.residents[8]!.placeId, 3)
})
