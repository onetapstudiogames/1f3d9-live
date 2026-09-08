import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayEvent } from '../src/city/types.ts'
import { activityEntry, activityReduce, activityVisible, createActivityContext, emptyActivity, type ActivityContext, type ActivityPlace } from '../src/activity.ts'

const places = new Map<number, ActivityPlace>([
  [1, { id: 1, name: 'the world', parentId: null, quiet: false, hasDrawing: true }],
  [2, { id: 2, name: 'the old square', parentId: 1, quiet: false, hasDrawing: false }],
  [3, { id: 3, name: 'the quiet house', parentId: 1, quiet: true, hasDrawing: false }],
  [4, { id: 4, name: 'the hidden room', parentId: 3, quiet: false, hasDrawing: false }],
] as const)
const context: ActivityContext = {
  resident: actor => actor === 'vigil' ? { type: 'resident', id: 7, name: 'vigil', hasDrawing: true } : null,
  place: id => places.get(id) ?? null,
  roomName: (id, time) => id === 2 && time >= 2_000 ? 'the new square' : places.get(id)?.name ?? null,
}
const row = (changeId: number, kind: string, detail: ReplayEvent['detail'], at = changeId * 1_000): ReplayEvent => ({
  actor: 'vigil', at: new Date(at).toISOString(), change_id: String(changeId), event_id: changeId,
  kind, detail,
})

test('formats recorded chats, moves, and made things with only linked entities', () => {
  const note = { ...row(1, 'note', { note_id: 9, place_id: 2 }), line: 'hello <city>', line_cut: false }
  assert.deepEqual(activityEntry(note, context), {
    key: '1', changeId: 1, time: 1_000, kind: 'chat', text: 'vigil in the old square: hello <city>',
    entities: [
      { type: 'resident', id: 7, name: 'vigil', hasDrawing: true },
      { type: 'place', id: 2, name: 'the old square', hasDrawing: false },
    ],
    cue: 'note', roomId: 2, anchorRoomId: 2, actorResidentId: 7,
  })
  assert.equal(activityEntry(row(2, 'action', { action: 'move', status: 'applied', from_place_id: 1, to_place_id: 2 }), context)?.text,
    'vigil moved from the world to the new square.')
  const made = activityEntry(row(3, 'thing_created', { thing_id: 22, place_id: 2, name: 'small bell' }), context)!
  assert.equal(made.text, 'vigil made small bell in the new square.')
  assert.deepEqual(made.entities.at(-1), { type: 'thing', id: 22, name: 'small bell', hasDrawing: null })
})

test('activity preserves the complete recorded note without changing the recorded event', () => {
  const note = { ...row(1, 'note', { note_id: 9, place_id: 2 }), line: 'first\nfull second line', line_cut: false }
  assert.equal(activityEntry(note, context)?.text, 'vigil in the old square: first\nfull second line')
  assert.equal(note.line, 'first\nfull second line')
})

test('activity marks unread cut text and removes the marker after verification', () => {
  const note = { ...row(1, 'note', { note_id: 9, place_id: 2 }), line: 'known beginning', line_cut: true }
  assert.equal(activityEntry(note, context)?.text, 'vigil in the old square: known beginning (rest not read)')
  assert.equal(activityEntry({ ...note, line: 'known beginning\nending', line_cut: false }, context)?.text,
    'vigil in the old square: known beginning\nending')
})

test('builds linked resident and place facts without replacing the recorded room-name resolver', () => {
  const built = createActivityContext([
    { id: 7, handle: ' vigil ', model: '', joined_at: '', has_drawing: true, current_place_id: 2, asleep: false },
  ], [{ id: 2, name: 'current name', parent_id: null, owner: null, owner_id: null, quiet: false, has_drawing: false }],
  (_place, time) => time < 2_000 ? 'historic name' : 'current name')
  assert.equal(built.resident('vigil')?.id, 7)
  assert.equal(built.roomName(2, 1_000), 'historic name')
})

test('rejects incomplete facts, failed moves, unknown rooms, and quiet ancestry', () => {
  assert.equal(activityEntry(row(1, 'action', { action: 'move', status: 'noop', from_place_id: 1, to_place_id: 2 }), context), null)
  assert.equal(activityEntry(row(1, 'note', { note_id: 9, place_id: 99 }), context), null)
  assert.equal(activityEntry(row(1, 'note', { note_id: 9, place_id: 4 }), context), null)
  assert.equal(activityEntry({ ...row(1, 'note', { note_id: 9, place_id: 2 }), actor: null }, context), null)
  assert.equal(activityEntry(row(1, 'thing_created', { thing_id: 2, place_id: 2, name: '   ' }), context), null)
})

test('reduces only due rows in change order, deduplicates, caps history, and resets cleanly', () => {
  const notes = Array.from({ length: 105 }, (_, index) => ({
    ...row(index + 1, 'note', { note_id: index + 1, place_id: 2 }), line: `line ${index + 1}`,
  }))
  const first = activityReduce(emptyActivity(), [...notes].reverse(), 103_500, context)
  assert.equal(first.entries.length, 100)
  assert.deepEqual(first.entries.map(entry => entry.changeId).slice(0, 2), [4, 5])
  assert.equal(first.highWater, 103)
  const retry = activityReduce(first, [notes[102]!, notes[103]!, notes[103]!], 104_500, context)
  assert.deepEqual(retry.entries.map(entry => entry.changeId).slice(-2), [103, 104])
  assert.equal(retry.entries.length, 100)
  const reset = activityReduce(emptyActivity(), [notes[0]!], 2_000, context)
  assert.deepEqual(reset.entries.map(entry => entry.changeId), [1])
})

test('the Chats filter keeps the bounded conversation rows without changing history', () => {
  const state = activityReduce(emptyActivity(), [
    row(1, 'action', { action: 'move', status: 'applied', from_place_id: 1, to_place_id: 2 }),
    { ...row(2, 'note', { note_id: 2, place_id: 2 }), line: 'hi' },
  ], 3_000, context)
  assert.deepEqual(activityVisible(state.entries, 'chats').map(entry => entry.kind), ['chat'])
  assert.equal(activityVisible(state.entries, 'all').length, 2)
})

test('describes every public event family with a pure cue and only proven anchors', () => {
  const cases: Array<[string, ReplayEvent['detail'], string]> = [
    ['register', {}, 'arrival'], ['rotate', {}, 'change'], ['resident_edited', { resident_id: 7 }, 'change'],
    ['home_set', { place_id: 2 }, 'home'], ['place_created', { place_id: 2, name: 'square' }, 'make'],
    ['kind_invented', { kind_id: 4, name: 'bell' }, 'make'], ['trait_coined', { trait_id: 5, name: 'bright' }, 'make'],
    ['thing_crafted', { thing_id: 22, place_id: 2, name: 'bell' }, 'make'],
    ['effect_scheduled', { effect_id: 3, place_id: 2 }, 'wait'], ['agreement_sign', { agreement_id: 4 }, 'agreement'],
    ['world_sale', { asset_type: 'place', asset_id: 2 }, 'trade'], ['flag', { target_type: 'place', target_id: 2 }, 'rules'],
  ]
  for (const [kind, detail, cue] of cases) assert.equal(activityEntry(row(10, kind, detail), context)?.cue, cue, kind)
  const global = activityEntry(row(11, 'rotate', {}), context)!
  assert.equal(global.anchorRoomId, null)
  assert.deepEqual(global.entities.map(entity => entity.type), ['resident'])
})

test('uses optional historical actor, resident, thing, and effect resolvers without inventing event location', () => {
  const richer: ActivityContext = {
    ...context,
    actorRoom: (_actor, time) => time === 1_000 ? 2 : null,
    residentById: id => id === 8 ? { type: 'resident', id, name: 'moss', hasDrawing: true } : null,
    thing: id => id === 22 ? { entity: { type: 'thing', id, name: 'bell', hasDrawing: true }, placeId: 2 } : null,
    effect: id => id === 3 ? { placeId: 2, thingId: 22 } : null,
  }
  const failed = activityEntry(row(1, 'action', { action: 'use', status: 'failed', source_thing_id: 22, error: 'too far' }), richer)!
  assert.equal(failed.cue, 'failed'); assert.equal(failed.roomId, null); assert.equal(failed.anchorRoomId, 2)
  assert.match(failed.text, /tried to use bell; failed: too far/)
  const gift = activityEntry(row(2, 'transfer', { mode: 'gift', thing_id: 22, resident_id: 8, place_id: 2 }), richer)!
  assert.deepEqual(gift.entities.map(entity => entity.name), ['vigil', 'the new square', 'bell', 'moss'])
  assert.equal(activityEntry(row(3, 'effect_resolved', { effect_id: 3, status: 'applied' }), richer)?.roomId, 2)
})

test('deduplicates stable event keys without dropping a later lower change id', () => {
  const first = activityReduce(emptyActivity(), [{ ...row(10, 'rotate', {}) }], 20_000, context)
  const second = activityReduce(first, [{ ...row(5, 'register', {}) }, { ...row(10, 'rotate', {}) }], 20_000, context)
  assert.deepEqual(second.entries.map(entry => entry.changeId), [10, 5])
})

test('explicit quiet and unknown rooms suppress their event and thing facts before actor anchoring', () => {
  const anchored: ActivityContext = { ...context, actorRoom: () => 2,
    thing: id => ({ entity: { type: 'thing', id, name: 'private keepsake', hasDrawing: true }, placeId: 3 }) }
  assert.equal(activityEntry(row(20, 'thing_edited', { thing_id: 22, place_id: 3 }), anchored), null)
  assert.equal(activityEntry(row(21, 'thing_edited', { thing_id: 22, place_id: 99 }), anchored), null)
  assert.equal(activityEntry(row(22, 'thing_edited', { thing_id: 22 }), anchored), null)
  assert.equal(activityEntry(row(23, 'rotate', {}), { ...context, actorRoom: () => 3 })?.anchorRoomId, null)
})

test('rejects malformed typed rows, error-bearing moves, and richer paired duplicates', () => {
  assert.equal(activityEntry(row(30, 'kind_invented', { name: 'missing id' }), context), null)
  assert.equal(activityEntry(row(31, 'agreement_sign', {}), context), null)
  assert.equal(activityEntry(row(32, 'effect_scheduled', { place_id: 2 }), context), null)
  assert.equal(activityEntry(row(33, 'action', { action: 'move', status: 'applied', from_place_id: 1, to_place_id: 2, error: 'no' }), context), null)
  const talk = row(34, 'action', { action_id: 8, action: 'talk', status: 'applied', place_id: 2 })
  const note = row(35, 'note', { action_id: 8, note_id: 3, place_id: 2 })
  assert.equal(activityEntry(talk, context, [talk, note]), null)
  const moved = row(36, 'thing_moved', { action_id: 9, thing_id: 22, mode: 'carry', place_id: 2 })
  const walk = row(37, 'action', { action_id: 9, action: 'move', status: 'applied', from_place_id: 1, to_place_id: 2 })
  assert.equal(activityEntry(moved, context, [moved, walk]), null)
})

test('accepts every kind in the published public vocabulary with valid public identifiers', () => {
  const kinds = ['register', 'rotate', 'resident_edited', 'home_set', 'place_created', 'place_edited', 'place_renamed', 'place_retired', 'place_restored',
    'kind_invented', 'kind_revised', 'trait_coined', 'thing_created', 'thing_crafted', 'thing_edited', 'thing_moved', 'thing_upgraded', 'thing_withdrawn',
    'laws_changed', 'action', 'effect_scheduled', 'effect_resolved', 'note', 'gazette_printed', 'agreement', 'agreement_accession', 'agreement_sign',
    'transfer', 'transfer_offer', 'sale', 'transfer_cancel', 'world_listed', 'world_sale', 'world_cancel', 'payment_repair', 'flag', 'moderation']
  const details: ReplayEvent['detail'] = { resident_id: 8, place_id: 2, parent_id: 1, thing_id: 22, kind_id: 3, trait_id: 4, agreement_id: 5,
    note_id: 6, offer_id: 7, effect_id: 8, issue_number: 9, target_id: 10, target_type: 'place', action: 'use', status: 'applied', name: 'bell' }
  const events = kinds.map((kind, index) => ({ ...row(index + 100, kind, details), ...(kind === 'note' ? { line: 'hello' } : {}) }))
  assert.equal(events.flatMap(event => activityEntry(event, context) ?? []).length, 37)
  assert.equal(kinds.length, 37)
  const gazette = activityEntry({ ...events[23]!, actor: 'the Gazette printer' }, context)!
  assert.equal(gazette.actorResidentId, null)
  assert.deepEqual(gazette.entities.map(entity => entity.type), ['place'])
})
