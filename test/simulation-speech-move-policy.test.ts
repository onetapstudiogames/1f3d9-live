import assert from 'node:assert/strict'
import test from 'node:test'

import type { ReplayEvent, ReplayFile, Resident } from '../src/city/types.ts'
import type { NestedLayout } from '../src/ground/nested.ts'
import { ROOM_RESIDENT_SIZE } from '../src/room-appearance.ts'
import { createResidents, dropSleepingResidentBubbles, stepResidents } from '../src/replay/simulation.ts'

const room = { id: 2, parentId: null, name: 'room', quiet: false, depth: 0, x: 0, y: 0, width: 320, height: 240,
  door: { x: 300, y: 120 }, standing: { x: 20, y: 20, width: 260, height: 180 }, children: [] }
const layout = { rooms: { 2: room }, rootId: 2, roots: [2], width: 320, height: 240 } as unknown as NestedLayout
const census: readonly Resident[] = [
  { id: 7, handle: 'ada', current_place_id: 2, model: '', joined_at: '', has_drawing: false, asleep: false },
  { id: 8, handle: 'bea', current_place_id: 2, model: '', joined_at: '', has_drawing: false, asleep: false },
]
const replay: ReplayFile = { span: '1h', window_start: '', window_end: '', checkpoint: '0', complete: true, row_ceiling: 1,
  map: { places: [] }, start: { 'resident:7': { place_id: 2 }, 'resident:8': { place_id: 2 } }, counts: {}, timeline: [] }
const note = (actor: string, changeId: string): ReplayEvent => ({ actor, at: '', change_id: changeId, event_id: Number(changeId),
  kind: 'note', detail: { place_id: 2 }, line: `${actor} speaks` })

test('stepResidents starts same-room notes in recorded order across residents', () => {
  const late = note('ada', '2')
  const early = note('bea', '1')
  let state = stepResidents(createResidents(replay, census, layout), [late, early], 0, 100, layout)
  assert.equal(state.residents[7]!.bubble, null)
  assert.equal(state.residents[8]!.bubble?.text, 'bea speaks')
  assert.deepEqual(state.startedEvents?.map(event => event.change_id), ['1'])

  const resumed = stepResidents(state, [], 0, state.residents[8]!.bubble!.expiresAt, layout)
  assert.equal(resumed.residents[7]!.bubble?.text, 'ada speaks')
  assert.equal(resumed.residents[8]!.bubble, null)
})

test('custom move hooks receive consumed queue state and may advance the walk', () => {
  const move: ReplayEvent = { actor: 'ada', at: '', change_id: '4', event_id: 4, kind: 'action',
    detail: { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 } }
  let startSawConsumed = false
  const options = {
    startMove: (resident: ReturnType<typeof createResidents>['residents'][number]) => {
      startSawConsumed = resident.queue.length === 0 && resident.lastActivityId === '4'
      return { ...resident, walking: true }
    },
    advanceMove: (resident: ReturnType<typeof createResidents>['residents'][number], deltaMs: number) =>
      ({ ...resident, walking: deltaMs < 20 }),
  }
  let state = stepResidents(createResidents(replay, census, layout), [move], 0, 100, layout, new Map(), undefined, options)
  assert.equal(startSawConsumed, true)
  assert.equal(state.residents[7]!.walking, true)
  state = stepResidents(state, [], 20, 120, layout, new Map(), undefined, options)
  assert.equal(state.residents[7]!.walking, false)
})

test('resident positions use the 56 pixel figure center', () => {
  const state = createResidents(replay, census.slice(0, 1), layout)
  assert.ok(state.residents[7]!.x >= room.standing.x + ROOM_RESIDENT_SIZE / 2)
  assert.ok(state.residents[7]!.y >= room.standing.y + ROOM_RESIDENT_SIZE / 2)
})

test('a busy doorway keeps its move queued and announces it only when the walk starts', () => {
  const move: ReplayEvent = { actor: 'ada', at: '', change_id: '4', event_id: 4, kind: 'action',
    detail: { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 } }
  const held = stepResidents(createResidents(replay, census, layout), [move], 0, 100, layout, new Map(), undefined,
    { startMove: () => null })
  assert.equal(held.residents[7]!.queue[0]?.event, move)
  assert.equal(held.residents[7]!.walking, false)
  assert.equal(held.residents[7]!.lastActivityId, undefined)
  assert.deepEqual(held.startedEvents, [])
  const released = stepResidents(held, [], 16, 116, layout, new Map(), undefined,
    { startMove: resident => ({ ...resident, walking: true }) })
  assert.equal(released.residents[7]!.queue.length, 0)
  assert.equal(released.residents[7]!.lastActivityId, '4')
  assert.deepEqual(released.startedEvents, [move])
})

test('a sleeper drops its active card before an awake queued note claims the room', () => {
  const first = note('ada', '1')
  const second = note('bea', '2')
  let state = stepResidents(createResidents(replay, census, layout), [first], 0, 100, layout)
  assert.equal(state.residents[7]!.bubble?.text, 'ada speaks')

  state = stepResidents(state, [second], 0, 101, layout, new Map(), undefined, { sleepers: new Set([7]) })
  assert.equal(state.residents[7]!.bubble, null)
  assert.equal(state.residents[8]!.bubble?.text, 'bea speaks')
})

test('a note delivered while asleep is recorded without a bubble and is not replayed after waking', () => {
  const sleepingNote = note('ada', '1')
  let state = stepResidents(createResidents(replay, census, layout), [sleepingNote], 0, 100, layout, new Map(), undefined,
    { sleepers: new Set([7]) })
  assert.equal(state.residents[7]!.bubble, null)
  assert.equal(state.residents[7]!.queue.length, 0)
  assert.deepEqual(state.startedEvents, [sleepingNote])

  const wakingNote = note('ada', '2')
  const wokeState = stepResidents(state, [wakingNote], 0, 101, layout)
  assert.equal(wokeState.residents[7]!.bubble?.text, 'ada speaks')
  assert.deepEqual(wokeState.startedEvents, [wakingNote])
})

test('presence updates can immediately disqualify an active sleeper bubble between steps', () => {
  const state = stepResidents(createResidents(replay, census, layout), [note('ada', '1')], 0, 100, layout)
  const cleared = dropSleepingResidentBubbles(state, new Set([7]))
  assert.equal(cleared.residents[7]!.bubble, null)
  assert.equal(cleared.pending, false)
  assert.equal(cleared.residents[8], state.residents[8])
  assert.equal(dropSleepingResidentBubbles(cleared, new Set([7])), cleared)
})
