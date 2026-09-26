import assert from 'node:assert/strict'
import test from 'node:test'
import { answerLogText, LINE_READ_ISSUE, lineEvent, lineLogText, pingLogText } from '../src/talk-words.ts'

test('room lines, pings, and fixed answers use the room log words', () => {
  assert.equal(LINE_READ_ISSUE, 'Some lines could not be read; they are left out of the picture.')
  assert.equal(lineLogText('vigil', 'hello there'), 'vigil: hello there')
  assert.equal(pingLogText('vigil', 'ada'), 'vigil pinged ada.')
  assert.equal(answerLogText('vigil', 'ada', 'yes'), "vigil answered ada's ping: yes.")
  assert.equal(answerLogText('vigil', 'ada', 'no'), "vigil answered ada's ping: no.")
  assert.equal(answerLogText('vigil', 'ada', 'in_a_moment'), "vigil answered ada's ping: in a moment.")
  assert.equal(answerLogText('vigil', 'ada', 'maybe'), null)
})

test('line events use the room line facts and do not change the input', () => {
  const line = { id: 42, placeId: 731, author: 'vigil', body: 'hello there', createdAt: '2026-09-25T10:00:00Z' }
  const before = { ...line }

  const event = lineEvent(line, '100299')

  assert.deepEqual(event, {
    kind: 'line_said', actor: 'vigil', at: '2026-09-25T10:00:00Z', change_id: '100299', event_id: 42,
    detail: { line_id: 42, place_id: 731 }, line: 'hello there', line_cut: false,
  })
  assert.deepEqual(line, before)
})
