import assert from 'node:assert/strict'
import test from 'node:test'
import { nestedLayout } from '../src/ground/nested.ts'
import { createPresentResidents, stepResidents, blocksLiveDelivery } from '../src/replay/simulation.ts'
import type { ResidentState } from '../src/replay/simulation.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import { actionFloorEvents } from '../src/action-delivery.ts'
import { refreshPresentResidents } from '../src/current-state.ts'

const layout = nestedLayout([{ id: 1, parent_id: null, name: 'room' }])
const initial = () => createPresentResidents([{ id: 7, handle: 'ada', current_place_id: 1, model: '', joined_at: '', has_drawing: false, asleep: false }], layout)
const use: ReplayEvent = { actor: 'ada', at: '2026-09-09T12:00:00Z', change_id: '11', event_id: 11, kind: 'action',
  detail: { action: 'use', status: 'applied', place_id: 1, source_thing_id: 5 } }
const consumed: ReplayEvent = { ...use, detail: { ...use.detail, action: 'consume' } }
const withdrawal: ReplayEvent = { ...use, change_id: '12', kind: 'thing_withdrawn', detail: { thing_id: 5 } }
const options = {
  startAction: (resident: ResidentState, event: ReplayEvent, _all: unknown, now: number) =>
    ({ ...resident, actionUntil: now + 2_000, actionEvent: event, walking: true }),
  advanceAction: (resident: ResidentState, _delta: number, now: number) => now < resident.actionUntil!
    ? { ...resident, walking: false }
    : { ...resident, actionUntil: null, actionEvent: null, walking: false },
}

test('action hooks consume one queue turn, hold during the shake, and never advance it as a room move', () => {
  let state = stepResidents(initial(), [use, { ...use, change_id: '13' }], 0, 100, layout, new Map(), undefined, options)
  assert.equal(state.residents[7]!.actionEvent, use)
  assert.equal(state.residents[7]!.queue.length, 1)
  assert.equal(blocksLiveDelivery(state), true)
  state = stepResidents(state, [], 1_000, 1_100, layout, new Map(), undefined,
    { ...options, advanceMove: () => { throw new Error('action advanced as room walk') } })
  assert.equal(state.residents[7]!.walking, false)
  assert.equal(state.residents[7]!.queue.length, 1)
  assert.equal(blocksLiveDelivery(state), true)
  state = stepResidents(state, [], 1_000, 2_100, layout, new Map(), undefined, options)
  assert.equal(state.residents[7]!.actionEvent, null)
  assert.equal(state.residents[7]!.queue.length, 1, 'finish effect before the next action starts')
  assert.deepEqual(state.startedEvents, [], 'completion does not re-announce a witnessed action')
})

test('busy actions retry without being marked started and fallback actions finish normally', () => {
  const held = stepResidents(initial(), [use], 0, 0, layout, new Map(), undefined, { startAction: () => null })
  assert.equal(held.residents[7]!.queue.length, 1)
  assert.deepEqual(held.startedEvents, [])
  const fallback = stepResidents(held, [], 1, 1, layout, new Map(), undefined, { startAction: () => undefined })
  assert.equal(fallback.residents[7]!.queue.length, 0)
  assert.equal(blocksLiveDelivery(fallback), false)
})

test('sleeping actors never start an action approach', () => {
  let called = false
  const state = stepResidents(initial(), [use], 0, 0, layout, new Map(), undefined,
    { sleepers: new Set([7]), startAction: () => { called = true; return null } })
  assert.equal(called, false)
  assert.equal(state.residents[7]!.queue.length, 0)
})

test('consume and its withdrawal remain on the floor until its action completes, while other things proceed', () => {
  const state = stepResidents(initial(), [consumed], 0, 0, layout, new Map(), undefined, options)
  const other = { ...withdrawal, change_id: '14', detail: { thing_id: 9 } }
  const held = actionFloorEvents([], [consumed, withdrawal, other], state.residents)
  assert.deepEqual(held.events, [other])
  assert.equal(held.held.length, 2)
  const finished = stepResidents(state, [], 2_000, 2_000, layout, new Map(), undefined, options)
  const released = actionFloorEvents(held.held, [], finished.residents)
  assert.deepEqual(released.events, [consumed, withdrawal])
  assert.deepEqual(released.held, [])
})

test('actions waiting behind speech delay their effects; earlier completed work can release before a later turn', () => {
  const later = { ...use, change_id: '15' }
  const state = initial()
  const residents = { ...state.residents, 7: { ...state.residents[7]!, queue: [{ event: use }, { event: later }] } }
  const held = actionFloorEvents([], [use, later], residents)
  assert.equal(held.events.length, 0)
  const released = actionFloorEvents(held.held, [], { ...residents, 7: { ...residents[7]!, queue: [{ event: later }] } })
  assert.deepEqual(released.events, [use])
  assert.equal(released.held[0]?.event, later)
})

test('earlier unrelated floor changes are not held behind a newer action', () => {
  const state = initial()
  const residents = { ...state.residents, 7: { ...state.residents[7]!, queue: [{ event: use }] } }
  const earlier = { ...withdrawal, change_id: '10' }
  assert.deepEqual(actionFloorEvents([], [earlier], residents).events, [earlier])
  const linked = { ...earlier, detail: { ...earlier.detail, action_id: 99 } }
  const linkedUse = { ...use, detail: { ...use.detail, action_id: 99 } }
  const waiting = { ...residents, 7: { ...residents[7]!, queue: [{ event: linkedUse }] } }
  assert.equal(actionFloorEvents([], [linked], waiting).held.length, 1)
})

test('a recorded noop use still approaches and defers its existing glow', () => {
  const noop = { ...use, detail: { ...use.detail, status: 'noop' } }
  const state = stepResidents(initial(), [noop], 0, 0, layout, new Map(), undefined, options)
  assert.equal(state.residents[7]!.actionEvent, noop)
  assert.equal(actionFloorEvents([], [noop], state.residents).held.length, 1)
})

test('a census refresh preserves the pending shake even after the approach stops walking', () => {
  const started = stepResidents(initial(), [use], 0, 0, layout, new Map(), undefined, options)
  const shaking = stepResidents(started, [], 1_000, 1_000, layout, new Map(), undefined, options)
  const refreshed = refreshPresentResidents(shaking, [{ id: 7, handle: 'ada', current_place_id: 1, model: '', joined_at: '', has_drawing: false, asleep: false }], layout)
  assert.equal(refreshed.state.pending, true)
  assert.equal(blocksLiveDelivery(refreshed.state), true)
})
