import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayEvent, ReplayPlace, Resident } from '../src/city/types.ts'
import { filterCurrentVisualEvents, returnToCurrentResidents } from '../src/current-return.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { createPresentResidents, type Simulation } from '../src/replay/simulation.ts'

const places: readonly ReplayPlace[] = [
  { id: 1, name: 'world', parent_id: null, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 2, name: 'square', parent_id: 1, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 3, name: 'garden', parent_id: 1, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 4, name: 'quiet room', parent_id: 1, owner: null, owner_id: null, quiet: true, has_drawing: false },
]
const layout = nestedLayout(places, { 1: 2, 2: 2, 3: 2, 4: 2 })
const censusResident = (placeId: number, asleep = false): Resident => ({
  id: 1, handle: 'resident-1', model: '', joined_at: '2026-01-01T00:00:00Z', has_drawing: false,
  current_place_id: placeId, asleep,
})
const move = (changeId: string, fromId: number, toId: number): ReplayEvent => ({
  actor: 'resident-1', at: `2026-01-01T00:00:${changeId.padStart(2, '0')}Z`, change_id: changeId,
  event_id: Number(changeId), kind: 'action', detail: { action: 'move', status: 'applied', from_place_id: fromId, to_place_id: toId },
})
const note = (changeId: string, placeId: number): ReplayEvent => ({
  actor: 'resident-1', at: `2026-01-01T00:00:${changeId.padStart(2, '0')}Z`, change_id: changeId,
  event_id: Number(changeId), kind: 'note', detail: { note_id: Number(changeId), place_id: placeId },
})

test('a census destination suppresses its duplicate walk but keeps a following leg and non-move records', () => {
  const state = createPresentResidents([censusResident(2)], layout)
  const fresh = [move('1', 1, 2), note('2', 2), move('3', 2, 3)]

  assert.deepEqual(filterCurrentVisualEvents(state, [], fresh).map(event => event.change_id), ['2', '3'])
  assert.deepEqual(fresh.map(event => event.change_id), ['1', '2', '3'], 'the separately witnessed input stays intact')
})

test('two fresh legs both play when the resident starts at the first source', () => {
  const state = createPresentResidents([censusResident(1)], layout)
  const fresh = [move('1', 1, 2), move('2', 2, 1)]

  assert.deepEqual(filterCurrentVisualEvents(state, [], fresh).map(event => event.change_id), ['1', '2'])
})

test('active, resident-queued, and live-queued destinations suppress only already represented moves', () => {
  const initial = createPresentResidents([censusResident(1)], layout)
  const active = { ...initial.residents[1]!, walking: true, destinationId: 2 }
  const activeState: Simulation = Object.freeze({ ...initial, residents: Object.freeze({ 1: Object.freeze(active) }) })
  assert.deepEqual(filterCurrentVisualEvents(activeState, [], [move('1', 1, 2)]), [])

  const pending = { ...initial.residents[1]!, queue: [{ event: move('2', 1, 2) }] }
  const pendingState: Simulation = Object.freeze({ ...initial, residents: Object.freeze({ 1: Object.freeze(pending) }) })
  assert.deepEqual(filterCurrentVisualEvents(pendingState, [], [move('3', 1, 2)]), [])

  assert.deepEqual(filterCurrentVisualEvents(initial, [move('4', 1, 2)], [move('5', 1, 2), move('6', 2, 3)])
    .map(event => event.change_id), ['6'])
})

test('returning to current truth drops old walks, queues, and temporary floats without inventing a walk', () => {
  const initial = createPresentResidents([censusResident(2)], layout)
  const old = { ...initial.residents[1]!, placeId: 1, walking: true, destinationId: 3,
    destination: { x: 9, y: 9 }, path: [{ x: 1, y: 1 }, { x: 9, y: 9 }], walkEventId: '8',
    queue: [{ event: move('9', 3, 2) }], transferUntil: 5_000, inventionUntil: 5_000, agreementUntil: 5_000 }
  const state: Simulation = Object.freeze({ ...initial, pending: true, residents: Object.freeze({ 1: Object.freeze(old) }) })

  const returned = returnToCurrentResidents(state, [censusResident(2)], layout)

  assert.equal(returned.residents[1]!.placeId, 2)
  assert.equal(returned.residents[1]!.walking, false)
  assert.equal(returned.residents[1]!.destinationId, null)
  assert.deepEqual(returned.residents[1]!.queue, [])
  assert.equal(returned.residents[1]!.transferUntil, null)
  assert.equal(returned.residents[1]!.inventionUntil, undefined)
  assert.equal(returned.residents[1]!.agreementUntil, undefined)
  assert.equal(returned.pending, false)
})

test('returning after an absence always discards the visible card and its waiting notes', () => {
  const initial = createPresentResidents([censusResident(2)], layout)
  const bubble = { text: 'still reading', cut: false, placeId: 2, startedAt: 0, charInterval: 1, expiresAt: 9_999 }
  const old = { ...initial.residents[1]!, bubble, queue: [{ event: note('7', 2) }] }
  const state: Simulation = Object.freeze({ ...initial, pending: true, residents: Object.freeze({ 1: Object.freeze(old) }) })

  for (const resident of [censusResident(2), censusResident(3), censusResident(2, true), censusResident(4)]) {
    const current = returnToCurrentResidents(state, [resident], layout)
    assert.equal(current.residents[1]!.bubble, null)
    assert.deepEqual(current.residents[1]!.queue, [])
    assert.equal(current.pending, false)
  }
})
