import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayPlace } from '../src/city/types.ts'
import type { SpeechBubble } from '../src/speech.ts'
import { ballotCells, confettiCells, showingFor, showingFrame, showingNoticeFor, spotlightCells } from '../src/showing.ts'
import type { NestedLayout } from '../src/ground/nested.ts'
import type { ReplayFile, Resident } from '../src/city/types.ts'
import { createResidents, stepResidents } from '../src/replay/simulation.ts'

const places = [{ id: 438, name: 'the showing room', quiet: false }] as ReplayPlace[]
const bubble = (text: string, placeId = 438, noteId?: number): SpeechBubble => ({ text, cut: false, placeId, noteId, startedAt: 100,
  charInterval: 20, expiresAt: 1_100 })

test('every exact showing-room note gets a spotlight, while only first-word VOTE gets a ballot', () => {
  assert.deepEqual(showingFor(bubble('ACT: a small song'), true, places), { ballot: false, confetti: false, startedAt: 100, expiresAt: 1_100 })
  assert.deepEqual(showingFor(bubble('  VOTE lantern'), true, places), { ballot: true, confetti: false, startedAt: 100, expiresAt: 1_100 })
  for (const text of ['NOT A VOTE', 'CORRECTION: VOTE lantern', 'my VOTE', 'VOTER', 'vote lantern']) {
    assert.equal(showingFor(bubble(text), true, places)?.ballot, false)
  }
})

test('confetti belongs only to the one verified published-count note', () => {
  const line = 'THE FIRST COUNT. Question one is closed.'
  assert.equal(showingFor(bubble(line, 438, 10059), true, places, 'founder')?.confetti, true)
  assert.equal(showingFor(bubble(line, 438, 10060), true, places, 'founder')?.confetti, false)
  assert.equal(showingFor(bubble(line, 438, 10059), true, places, 'someone-else')?.confetti, false)
  assert.equal(showingFor(bubble('CORRECTION TO MY OWN COUNT, note #10059.', 438, 10065), true, places, 'founder')?.confetti, false)
})

test('a reference-only recorded note gets a brief spotlight without guessed contest meaning', () => {
  const event = { actor: 'ada', at: '2026-09-07T00:00:00Z', change_id: '12', event_id: 12, kind: 'note',
    detail: { note_id: 77, place_id: 438 } }
  const moment = showingNoticeFor(event, 100, 120, places)
  assert.equal(moment?.ballot, false)
  assert.equal(moment?.confetti, false)
  assert.ok((moment?.expiresAt ?? 0) > 100)
  assert.equal(showingNoticeFor({ ...event, actor: null }, 100, 120, places), null)
  assert.equal(showingNoticeFor({ ...event, detail: { place_id: 438 } }, 100, 120, places), null)
})

test('a reference-only spotlight holds a later recorded walk, then drains cleanly', () => {
  const layout = { rootId: 1, width: 520, height: 220, rooms: {
    1: { id: 1, parentId: null, name: 'world', quiet: false, depth: 0, x: 0, y: 0, width: 220, height: 180,
      door: { x: 200, y: 90 }, standing: { x: 20, y: 20, width: 160, height: 130 }, children: [438] },
    438: { id: 438, parentId: 1, name: 'the showing room', quiet: false, depth: 1, x: 300, y: 0, width: 220, height: 180,
      door: { x: 300, y: 90 }, standing: { x: 320, y: 20, width: 160, height: 130 }, children: [] },
  } } as unknown as NestedLayout
  const replay: ReplayFile = { span: '1h', window_start: '2026-09-07T00:00:00Z', window_end: '2026-09-07T01:00:00Z',
    checkpoint: '2', complete: true, row_ceiling: 2, map: { places: [] }, counts: {}, timeline: [],
    start: { 'resident:1': { origin_event_id: 1, place_id: 438 } } }
  const census: Resident[] = [{ id: 1, handle: 'ada', current_place_id: 438, model: '', joined_at: '', has_drawing: false, asleep: false }]
  const note = { actor: 'ada', at: replay.window_start, change_id: '1', event_id: 1, kind: 'note', detail: { note_id: 77, place_id: 438 } }
  const walk = { actor: 'ada', at: replay.window_start, change_id: '2', event_id: 2, kind: 'action',
    detail: { action: 'move', status: 'applied', from_place_id: 438, to_place_id: 1 } }
  let state = stepResidents(createResidents(replay, census, layout), [note, walk], 0, 100, layout)
  const expires = state.residents[1]!.showingNotice!.expiresAt
  assert.equal(state.residents[1]!.walking, false)
  assert.equal(state.residents[1]!.queue.length, 1)
  state = stepResidents(state, [], 0, expires, layout)
  assert.equal(state.residents[1]!.showingNotice, null)
  assert.equal(state.residents[1]!.walking, true)
})

test('missing, hidden, quiet, wrong-name, and wrong-room notes draw nothing', () => {
  assert.equal(showingFor(null, true, places), null)
  assert.equal(showingFor(bubble('ACT'), false, places), null)
  assert.equal(showingFor(bubble('ACT', 2), true, places), null)
  assert.equal(showingFor(bubble('ACT'), true, [{ ...places[0]!, quiet: true }]), null)
  assert.equal(showingFor(bubble('ACT'), true, [{ ...places[0]!, name: 'almost showing' }]), null)
  assert.equal(showingFor({ ...bubble('ACT'), startedAt: Number.NaN }, true, places), null)
})

test('the effect follows the existing bubble lifetime and expires exactly', () => {
  const moment = showingFor(bubble('VOTE lantern'), true, places)!
  assert.equal(showingFrame(moment, 99), null)
  assert.deepEqual(showingFrame(moment, 100), { alpha: 0, ballotY: -20, confetti: 0 })
  const middle = showingFrame(moment, 600)!
  assert.equal(middle.alpha, 1)
  assert.equal(middle.ballotY, 12)
  const [paper, , box, slot] = ballotCells()
  assert.ok(paper!.x >= slot!.x && paper!.x + paper!.width <= slot!.x + slot!.width)
  assert.ok(paper!.y + middle.ballotY >= box!.y && paper!.y + middle.ballotY < box!.y + box!.height)
  assert.equal(showingFrame(moment, 1_100), null)
})

test('spotlight, ballot, and box use bounded pixel rectangles', () => {
  for (const cells of [spotlightCells(), ballotCells(), confettiCells()]) {
    assert.ok(cells.length > 2)
    assert.ok(cells.every(cell => [cell.x, cell.y, cell.width, cell.height].every(Number.isInteger)))
    assert.ok(cells.every(cell => cell.width > 0 && cell.height > 0))
    assert.ok(Object.isFrozen(cells))
  }
})
