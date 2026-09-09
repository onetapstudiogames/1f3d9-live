import assert from 'node:assert/strict'
import test from 'node:test'
import { actionCaption, activeActionCaptions, layoutActionCaptions } from '../src/action-captions.ts'
import type { ActivityEntry } from '../src/activity.ts'
import { activityEntry, type ActivityContext } from '../src/activity.ts'
import type { ReplayEvent } from '../src/city/types.ts'

const entry = (text: string, cue: ActivityEntry['cue'] = 'action', key = text): ActivityEntry => ({
  key, changeId: 1, time: 0, kind: 'event', text, cue, roomId: 2, anchorRoomId: 2,
  actorResidentId: 7, entities: [{ type: 'resident', id: 7, name: 'vigil', hasDrawing: true }],
})

test('caption uses the witnessed log words without the actor and excludes talk', () => {
  const rows = [
    ['vigil used a measure of contempt-draught.', 'used a measure of contempt-draught', 'use'],
    ['vigil made a brass vial.', 'made a brass vial', 'make'],
    ['vigil gave a lamp to gleam.', 'gave a lamp to gleam', 'give'],
    ['vigil ate a sandwich.', 'ate a sandwich', 'consume'],
    ['vigil looked around.', 'looked around', 'looking'],
    ['vigil signed agreement #12.', 'signed agreement #12', 'agreement'],
    ['vigil invented a kind: lamp.', 'invented a kind: lamp', 'make'],
    ['vigil set home here.', 'set home here', 'home'],
    ['vigil changed the local laws.', 'changed the local laws', 'rules'],
    ['vigil founded the still room.', 'founded the still room', 'make'],
    ['vigil tried to use a lamp; failed: too far.', 'tried to use a lamp; failed: too far', 'failed'],
    ['vigil tried to use a lamp; refused.', 'tried to use a lamp; refused', 'failed'],
    ['vigil tried to use a lamp; blocked.', 'tried to use a lamp; blocked', 'failed'],
  ] as const
  for (const [source, words, cue] of rows) assert.equal(actionCaption(entry(source, cue), 100)?.text, words)
  assert.equal(actionCaption(entry('vigil talked.', 'note'), 100), null)
  assert.equal(actionCaption({ ...entry('the city changed something.'), actorResidentId: null }, 100), null)
})

test('real public rows produce the required caption words through the activity formatter', () => {
  const context: ActivityContext = {
    resident: name => ({ type: 'resident', id: name === 'gleam' ? 8 : 7, name, hasDrawing: true }),
    residentById: id => ({ type: 'resident', id, name: id === 8 ? 'gleam' : 'vigil', hasDrawing: true }),
    place: id => ({ id, name: id === 2 ? 'the still room' : 'the world', parentId: null, quiet: false, hasDrawing: false }),
    roomName: id => id === 2 ? 'the still room' : 'the world', actorRoom: () => 2,
    thing: id => ({ entity: { type: 'thing', id, name: id === 10 ? 'a measure of contempt-draught' : id === 11 ? 'lamp' : 'sandwich', hasDrawing: true }, placeId: 2 }),
  }
  const row = (id: number, kind: string, detail: ReplayEvent['detail']): ReplayEvent => ({ actor: 'vigil',
    at: '2026-01-01T00:00:00Z', change_id: String(id), event_id: id, kind, detail })
  const cases: readonly [ReplayEvent, string][] = [
    [row(1, 'action', { action: 'use', status: 'applied', thing_id: 10, place_id: 2 }), 'used a measure of contempt-draught'],
    [row(2, 'thing_created', { thing_id: 20, place_id: 2, name: 'a brass vial' }), 'made a brass vial'],
    [row(3, 'action', { action: 'give', status: 'applied', thing_id: 11, resident_id: 8, place_id: 2 }), 'gave a lamp to gleam'],
    [row(4, 'action', { action: 'consume', status: 'applied', thing_id: 12, place_id: 2 }), 'ate a sandwich'],
    [row(5, 'agreement_sign', { agreement_id: 12, place_id: 2 }), 'signed agreement #12'],
    [row(6, 'kind_invented', { kind_id: 9, name: 'lamp', place_id: 2 }), 'invented a kind: lamp'],
    [row(7, 'home_set', { place_id: 2 }), 'set home here'],
    [row(8, 'laws_changed', { place_id: 2 }), 'changed the local laws'],
    [row(9, 'place_created', { place_id: 2, name: 'the still room' }), 'founded the still room'],
    [row(10, 'action', { action: 'use', status: 'blocked', thing_id: 11 }), 'tried to use a lamp; blocked'],
  ]
  for (const [event, expected] of cases) {
    const formatted = activityEntry(event, context)
    assert.ok(formatted, event.kind)
    assert.equal(actionCaption(formatted, 0)?.text, expected, event.kind)
  }
  const sameRoom = activityEntry(row(11, 'action', { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 2 }), context)!
  assert.equal(actionCaption(sameRoom, 0)?.text, 'moved within the still room')
  const failedTalk = activityEntry(row(12, 'action', { action: 'talk', status: 'failed' }), context)!
  assert.equal(actionCaption(failedTalk, 0)?.text, 'tried to talk; failed')
  assert.equal(actionCaption(activityEntry(row(13, 'action', { action: 'talk', status: 'noop' }), context)!, 0), null)
})

test('captions last three seconds and can be cleared by replacing the collection', () => {
  const caption = actionCaption(entry('vigil made a lamp.'), 500)!
  assert.equal(caption.expiresAt, 3_500)
  assert.deepEqual(activeActionCaptions([caption], 3_499), [caption])
  assert.deepEqual(activeActionCaptions([caption], 3_500), [])
  assert.deepEqual(activeActionCaptions([], 500), [])
})

test('simultaneous captions stack inside edge viewports clear of speech and the resident name', () => {
  const captions = [
    actionCaption(entry('vigil made a lamp.', 'make', 'a'), 0)!,
    actionCaption(entry('vigil signed agreement #12.', 'agreement', 'b'), 0)!,
  ]
  const residents = { 7: { id: 7, x: 18, y: 92, visible: true } }
  const speech = [{ residentId: 7, x: 0, y: 0, width: 180, height: 70 }]
  const frames = layoutActionCaptions(captions, residents, { width: 190, height: 240 }, speech)
  assert.equal(frames.length, 2)
  for (const frame of frames) {
    assert.ok(frame.x >= 8 && frame.x + frame.width <= 182)
    assert.ok(frame.y >= 8 && frame.y + frame.height <= 232)
    assert.ok(frame.y >= 126 || frame.y + frame.height <= 70)
  }
  assert.ok(frames[0]!.y + frames[0]!.height <= frames[1]!.y || frames[1]!.y + frames[1]!.height <= frames[0]!.y)
})
