import assert from 'node:assert/strict'
import test from 'node:test'
import { noteWords, verifiedNoteEvent, WALK_TO_READ_LINE, walkToReadWords } from '../src/note-words.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import { bubbleFor, speechCardFrame } from '../src/speech.ts'

test('verified note words keep the complete raw body without a marker', () => {
  const body = '  first line\nsecond line 👩🏽‍💻  '
  assert.equal(noteWords(body, false), body)
})

test('a saved cut body carries an honest suffix until the full body is verified', () => {
  assert.equal(noteWords('known beginning', true), 'known beginning (rest not read)')
  assert.equal(noteWords('known beginning\nwhole ending', false), 'known beginning\nwhole ending')
})

test('a witnessed note accepts only its complete matching public body', () => {
  const event: ReplayEvent = { actor: 'Ada', at: new Date(0).toISOString(), change_id: '7', event_id: 7,
    kind: 'note', detail: { note_id: 3, place_id: 2 }, line: 'first', line_cut: true }
  const body = { author: 'Ada', placeId: 2, text: 'first\nlast', cut: false }
  assert.equal(verifiedNoteEvent(event, null), null)
  assert.equal(verifiedNoteEvent(event, { ...body, author: 'Bea' }), null)
  assert.equal(verifiedNoteEvent(event, { ...body, placeId: 1 }), null)
  assert.equal(verifiedNoteEvent(event, { ...body, cut: true }), null)
  assert.deepEqual(verifiedNoteEvent(event, body), { ...event, line: body.text, line_cut: false })
})

test('a matching removed note is marked without keeping its line', () => {
  const event: ReplayEvent = { actor: 'Ada', at: new Date(0).toISOString(), change_id: '7', event_id: 7,
    kind: 'note', detail: { note_id: 3, place_id: 2 }, line: 'removed text', line_cut: false }
  const removed = verifiedNoteEvent(event, { author: 'Ada', placeId: 2, text: '', cut: false, removed: true })
  assert.deepEqual(removed, { actor: 'Ada', at: event.at, change_id: '7', event_id: 7,
    kind: 'note', detail: { note_id: 3, place_id: 2 }, note_removed: true })
  assert.equal(verifiedNoteEvent(event, { author: 'Bea', placeId: 2, text: '', cut: false, removed: true }), null)
})

test('a walk-to-read card shows the public first line, then one fixed line, and never a body', () => {
  assert.equal(WALK_TO_READ_LINE, '(rest read in person)')
  assert.equal(walkToReadWords('Field note, east wall'), 'Field note, east wall\n(rest read in person)')
  assert.equal(walkToReadWords('[removed by maintainer]'), '[removed by maintainer]\n(rest read in person)')
  assert.equal(walkToReadWords(''), '(rest read in person)')
  assert.equal(walkToReadWords('   '), '(rest read in person)')
  assert.equal(noteWords(walkToReadWords('Field note, east wall'), false).includes('(rest not read)'), false)
})

test('a witnessed walk-to-read note keeps the same match rules and is complete as published', () => {
  const event: ReplayEvent = { actor: 'buzz', at: new Date(0).toISOString(), change_id: '9', event_id: 9,
    kind: 'note', detail: { note_id: 17942, place_id: 782 } }
  const firstLine = { author: 'buzz', placeId: 782, text: 'Field note, east wall', cut: false, readInPerson: true } as const
  assert.deepEqual(verifiedNoteEvent(event, firstLine),
    { ...event, line: 'Field note, east wall\n(rest read in person)', line_cut: false })
  assert.equal(verifiedNoteEvent(event, { ...firstLine, author: 'someone-else' }), null)
  assert.equal(verifiedNoteEvent(event, { ...firstLine, placeId: 1 }), null)
  assert.equal(verifiedNoteEvent({ ...event, actor: null }, firstLine), null)
})

test('the speech card types the first line and the fixed line whole, with no cut marker', () => {
  const event: ReplayEvent = { actor: 'buzz', at: new Date(0).toISOString(), change_id: '9', event_id: 9,
    kind: 'note', detail: { note_id: 17942, place_id: 782 } }
  const verified = verifiedNoteEvent(event, { author: 'buzz', placeId: 782, text: 'Field note, east wall', cut: false, readInPerson: true })!
  const bubble = bubbleFor(verified, 0)!
  // 8.4 pixels per character is the wider of the card's two 14-pixel monospace fonts; the fixed line fits one card line.
  const frame = speechCardFrame(bubble, bubble.expiresAt - 1, 240, 200, text => text.length * 8.4)
  assert.equal(frame.complete, true)
  assert.equal(frame.cut, false)
  assert.equal(frame.revealed, 'Field note, east wall\n(rest read in person)')
  assert.equal(frame.lines.length, 2)
  assert.equal(frame.lines.join('').replace('\n', ''), 'Field note, east wall(rest read in person)')
})
