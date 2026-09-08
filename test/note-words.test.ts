import assert from 'node:assert/strict'
import test from 'node:test'
import { noteWords, verifiedNoteEvent } from '../src/note-words.ts'
import type { ReplayEvent } from '../src/city/types.ts'

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
