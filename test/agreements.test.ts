import assert from 'node:assert/strict'
import test from 'node:test'
import { agreementSignature, HAND_PIXELS, handshakeDuration, handshakeFrame, planHandshake, readAgreementPairs } from '../src/agreements.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import type { NestedLayout } from '../src/ground/nested.ts'
import type { ReplayFile, Resident } from '../src/city/types.ts'
import { createResidents, stepResidents } from '../src/replay/simulation.ts'

const sign = (actor: string | null = 'ada', id: unknown = 14): ReplayEvent => ({ actor, at: '2026-09-01T00:00:00Z',
  change_id: '9', event_id: 9, kind: 'agreement_sign', detail: { agreement_id: id } })
const pair = new Map([['9', { agreementId: 14, parties: ['ada', 'bob'] as const }]])
const layout = { rootId: 1, width: 300, height: 200, rooms: { 1: { id: 1, parentId: null, name: 'room', quiet: false,
  depth: 0, x: 0, y: 0, width: 300, height: 200, door: { x: 0, y: 100 }, standing: { x: 20, y: 20, width: 260, height: 160 }, children: [] } } } as unknown as NestedLayout
const resident = (id: number, handle: string, x: number, y = 100) => ({ id, handle, placeId: 1, x, y, visible: true, walking: false,
  busy: false })

test('only a verified signature and exact pair identifies a handshake', () => {
  assert.deepEqual(agreementSignature(sign(), pair), { changeId: '9', agreementId: 14, signer: 'ada', parties: ['ada', 'bob'] })
  assert.equal(agreementSignature({ ...sign(), kind: 'agreement' }, pair), null)
  assert.equal(agreementSignature(sign('nobody'), pair), null)
  assert.equal(agreementSignature(sign('ada', 0), pair), null)
  assert.equal(agreementSignature(sign(), new Map()), null)
})

test('a clear same-room pair meets and returns without changing saved positions', () => {
  const residents = { 1: resident(1, 'ada', 80), 2: resident(2, 'bob', 220) }
  const before = JSON.stringify(residents)
  const plan = planHandshake(agreementSignature(sign(), pair)!, residents, layout, {})!
  assert.equal(JSON.stringify(residents), before)
  assert.ok(plan.leftTarget.x < plan.rightTarget.x)
  assert.deepEqual(handshakeFrame(plan, 0, 120)?.left, plan.leftStart)
  const meeting = handshakeFrame(plan, handshakeDuration(120) / 2, 120)!
  assert.equal(meeting.hands, true)
  assert.equal(handshakeFrame(plan, handshakeDuration(120), 120), null)
})

test('different, quiet, busy, or blocked pairs do not invent a meeting', () => {
  const base = { 1: resident(1, 'ada', 80), 2: resident(2, 'bob', 220) }
  assert.equal(planHandshake(agreementSignature(sign(), pair)!, { ...base, 2: { ...base[2], placeId: 2 } }, layout, {}), null)
  assert.equal(planHandshake(agreementSignature(sign(), pair)!, { ...base, 2: { ...base[2], busy: true } }, layout, {}), null)
  const quiet = { ...layout, rooms: { 1: { ...layout.rooms[1]!, quiet: true } } }
  assert.equal(planHandshake(agreementSignature(sign(), pair)!, base, quiet, {}), null)
  assert.equal(planHandshake(agreementSignature(sign(), pair)!, { ...base, 3: resident(3, 'carol', 150) }, layout, {}), null)
  assert.equal(planHandshake(agreementSignature(sign(), pair)!, { ...base, 3: { ...resident(3, 'carol', 50), walking: true } }, layout, {}), null)
  assert.equal(planHandshake(agreementSignature(sign(), pair)!, { ...base, 3: { ...resident(3, 'carol', 50), placeId: 2,
    destinationId: 3, walking: true } }, layout, {}), null)
  assert.equal(planHandshake(agreementSignature(sign(), pair)!, base, layout, { 1: [{ key: 'thing:1', kind: 'thing', x: 134, y: 84, width: 32, height: 32 }] }), null)
})

test('a distant pair stays unstaged instead of dashing across a huge floor', () => {
  const huge = { ...layout, width: 1_000, rooms: { 1: { ...layout.rooms[1]!, width: 1_000,
    standing: { x: 20, y: 20, width: 960, height: 160 } } } } as unknown as NestedLayout
  assert.equal(planHandshake(agreementSignature(sign(), pair)!, { 1: resident(1, 'ada', 40), 2: resident(2, 'bob', 960) }, huge, {}), null)
})

test('meeting routes refuse an inflated child wall and diagonal square overlap', () => {
  const child = { id: 2, parentId: 1, name: 'child', quiet: false, depth: 1, x: 125, y: 70, width: 50, height: 60,
    door: { x: 125, y: 100 }, standing: { x: 135, y: 80, width: 30, height: 40 }, children: [] }
  const walled = { ...layout, rooms: { 1: { ...layout.rooms[1]!, children: [2] }, 2: child } } as unknown as NestedLayout
  const base = { 1: resident(1, 'ada', 80), 2: resident(2, 'bob', 220) }
  assert.equal(planHandshake(agreementSignature(sign(), pair)!, base, walled, {}), null)
  const diagonal = { ...base, 3: resident(3, 'carol', 150 + 31, 100 + 31) }
  assert.equal(planHandshake(agreementSignature(sign(), pair)!, diagonal, layout, {}), null)
})

test('timing scales to a floor and the hands are crisp immutable pixels', () => {
  assert.equal(handshakeDuration(60), 11_200)
  assert.equal(handshakeDuration(120), 5_600)
  assert.equal(handshakeDuration(300), 2_240)
  assert.equal(handshakeDuration(1_000), 1_800)
  assert.ok(HAND_PIXELS.length > 4)
  assert.ok(HAND_PIXELS.every(cell => Number.isInteger(cell.x) && Number.isInteger(cell.y)))
  assert.ok(Object.isFrozen(HAND_PIXELS))
})

test('agreement pair reads run four at a time, retain successes, and report failures', async () => {
  const events = Array.from({ length: 10 }, (_, index) => ({ ...sign(), change_id: String(index + 1), event_id: index + 1 }))
  let active = 0; let peak = 0
  const result = await readAgreementPairs(events, async event => {
    active += 1; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 1))
    active -= 1
    if (event.change_id === '6') throw new Error('offline')
    return event.change_id === '8' ? null : { agreementId: 14, parties: ['ada', 'bob'] }
  }, new Map([['1', { agreementId: 14, parties: ['ada', 'bob'] as const }]]))
  assert.equal(peak, 4)
  assert.equal(result.failed, true)
  assert.equal(result.pairs.size, 8)
  assert.equal(result.pairs.has('6'), false)
  assert.equal(result.pairs.has('8'), false)
})

test('a signature holds both people and leaves the signer next event queued', () => {
  const replay: ReplayFile = { span: '1h', window_start: '2026-09-01T00:00:00Z', window_end: '2026-09-01T01:00:00Z',
    checkpoint: '9', complete: true, row_ceiling: 2, map: { places: [] }, counts: {}, timeline: [],
    start: { 'resident:1': { origin_event_id: 1, place_id: 1 }, 'resident:2': { origin_event_id: 1, place_id: 1 } } }
  const census: Resident[] = [
    { id: 1, handle: 'ada', current_place_id: 1, model: '', joined_at: '', has_drawing: false, asleep: false },
    { id: 2, handle: 'bob', current_place_id: 1, model: '', joined_at: '', has_drawing: false, asleep: false },
  ]
  const note = { ...sign(), change_id: '10', event_id: 10, kind: 'note', line: 'afterward', detail: { place_id: 1 } }
  let state = stepResidents(createResidents(replay, census, layout), [sign(), note], 0, 0, layout, 120, pair)
  assert.equal(state.startedHandshakes?.length, 1)
  assert.equal(state.residents[1]?.queue.length, 1)
  assert.equal(state.residents[2]?.agreementUntil, handshakeDuration(120))
  state = stepResidents(state, [], 0, handshakeDuration(120), layout, 120, pair)
  assert.equal(state.residents[1]?.bubble?.text, 'afterward')
  assert.equal(state.residents[2]?.agreementUntil, null)
})
