import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayEvent, ReplayFile, Resident } from '../src/city/types.ts'
import type { AgreementPair } from '../src/city/agreements.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { createResidents, stepResidents } from '../src/replay/simulation.ts'
import { handshakeDuration } from '../src/agreements.ts'
import { settleAtNow } from '../src/live.ts'

const places = [1, 2, 3].map(id => ({ id, parent_id: id === 1 ? null : 1, name: `room ${id}`,
  owner: null, owner_id: null, quiet: false, has_drawing: false }))
const layout = nestedLayout(places, { 1: 20, 2: 4, 3: 4 })
const record: ReplayFile = { span: '1h', window_start: '2026-09-01T00:00:00Z', window_end: '2026-09-01T01:00:00Z',
  checkpoint: '9', complete: true, row_ceiling: 2, map: { places }, counts: {}, timeline: [],
  start: Object.fromEntries([1, 2, 3].map(id => [`resident:${id}`, { origin_event_id: 1, place_id: 1 }])) }
const census: Resident[] = ['ada', 'bob', 'carol'].map((handle, index) => ({ id: index + 1, handle, current_place_id: 1,
  model: '', joined_at: '', has_drawing: false, asleep: false }))
const row = (kind: string, actor: string, detail: ReplayEvent['detail']): ReplayEvent => ({ kind, actor, detail,
  at: '2026-09-01T00:00:00Z', change_id: '9', event_id: 9 })
const signature = row('agreement_sign', 'ada', { agreement_id: 14 })
const pairs = new Map([['9', { agreementId: 14, parties: ['ada', 'bob'] as const }]])

function initial() {
  const state = createResidents(record, census, layout)
  const bounds = layout.rooms[1]!.standing
  const positions = [{ x: bounds.x + 60, y: bounds.y + 60 }, { x: bounds.x + 200, y: bounds.y + 60 },
    { x: bounds.x + 60, y: bounds.y + 160 }]
  return { ...state, residents: Object.fromEntries(Object.values(state.residents).map((resident, index) =>
    [resident.id, { ...resident, ...positions[index]! }])) }
}

test('a later walk waits for the meeting to finish and keeps its next note in order', () => {
  let state = stepResidents(initial(), [signature], 0, 0, layout, pairs)
  assert.equal(state.startedHandshakes?.length, 1)
  const move = row('action', 'carol', { action: 'move', status: 'applied', from_place_id: 1, to_place_id: 2 })
  const note = { ...row('note', 'carol', { place_id: 2 }), line: 'after the walk' }
  state = stepResidents(state, [move, note], 100, 100, layout, pairs)
  assert.equal(state.residents[3]!.walking, false)
  assert.equal(state.residents[3]!.queue.length, 2)
  assert.equal(state.residents[3]!.queue[0]!.event, move)
  state = stepResidents(state, [], 0, handshakeDuration() + 1, layout, pairs)
  assert.equal(state.residents[3]!.walking, true)
  assert.equal(state.residents[3]!.queue[0]!.event, note)
})

test('a later gift to either held participant waits without losing its record', () => {
  for (const recipient of [1, 2]) {
    let state = stepResidents(initial(), [signature], 0, 0, layout, pairs)
    const gift = row('transfer', 'carol', { mode: 'gift', asset_type: 'thing', asset_id: 5, resident_id: recipient, place_id: 1 })
    state = stepResidents(state, [gift], 100, 100, layout, pairs)
    assert.equal(state.startedTransfers.length, 0)
    assert.equal(state.residents[3]!.queue[0]!.event, gift)
    state = stepResidents(state, [], 0, handshakeDuration() + 1, layout, pairs)
    assert.equal(state.startedTransfers.length, 1)
    assert.equal(state.residents[3]!.queue.length, 0)
  }
})

test('a presentation-hidden partner cannot start a meeting with a visible signer', () => {
  const state = stepResidents(initial(), [signature], 0, 0, layout, pairs, resident => resident.id !== 2)
  assert.equal(state.startedHandshakes?.length, 0)
  assert.ok(state.issues.some(issue => issue.includes('signatures could not be shown')))
  assert.equal(state.residents[1]!.agreementUntil, undefined)
})

test('a note that would place another figure elsewhere waits until the meeting returns', () => {
  let state = stepResidents(initial(), [signature], 0, 0, layout, pairs)
  const note = { ...row('note', 'carol', { place_id: 2 }), line: 'recorded elsewhere' }
  state = stepResidents(state, [note], 100, 100, layout, pairs)
  assert.equal(state.residents[3]!.placeId, 1)
  assert.equal(state.residents[3]!.queue[0]!.event, note)
  state = stepResidents(state, [], 0, handshakeDuration() + 1, layout, pairs)
  assert.equal(state.residents[3]!.placeId, 2)
  assert.equal(state.residents[3]!.bubble?.text, 'recorded elsewhere')
})

test('two simultaneous signatures cannot send different pairs through each other', () => {
  const start = initial()
  const fourth = { ...start.residents[3]!, id: 4, handle: 'dave', x: start.residents[2]!.x }
  const state = { ...start, residents: { ...start.residents, 4: fourth }, actors: new Map([...start.actors, ['dave', 4]]) }
  const second = { ...row('agreement_sign', 'carol', { agreement_id: 15 }), change_id: '10', event_id: 10 }
  const linked = new Map<string, AgreementPair>([...pairs, ['10', { agreementId: 15, parties: ['carol', 'dave'] as const }]])
  const next = stepResidents(state, [signature, second], 0, 0, layout, linked)
  assert.equal(next.startedHandshakes?.length, 1)
  assert.ok(next.issues.some(issue => issue.includes('signatures could not be shown')))
})

test('opening at now drains an older signature without leaving a meeting or queue behind', () => {
  const settled = settleAtNow({ ...record, timeline: [signature] }, census, layout, pairs)
  assert.equal(settled.residents.pending, false)
  assert.equal(settled.residents.startedHandshakes?.length ?? 0, 0)
  assert.ok(Object.values(settled.residents.residents).every(resident => resident.agreementUntil == null && resident.queue.length === 0))
})
