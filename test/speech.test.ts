import assert from 'node:assert/strict'
import test from 'node:test'

import { bubbleDuration, bubbleFor, bubbleRects, bubbleShape, splitGraphemes, typingInterval, typedBubbleFrame, wrapLines } from '../src/speech.ts'
import type { ReplayEvent, ReplayPlace } from '../src/city/types.ts'

const note = (line: string, placeId = 3, cut = false): ReplayEvent => ({ actor: 'ada', at: '2026-01-01T00:00:00Z',
  change_id: '1', event_id: 1, kind: 'note', detail: { place_id: placeId }, line, line_cut: cut })

test('typing pace scales but keeps a readable floor', () => {
  assert.equal(typingInterval(60), 68)
  assert.equal(typingInterval(120), 34)
  assert.equal(typingInterval(300), 18)
  assert.equal(typingInterval(Number.NaN), 34)
})

test('typing reveals a whole Unicode grapheme, never half an emoji', () => {
  const bubble = bubbleFor(note('👩🏽‍💻a'), 0, 120)!
  assert.equal(typedBubbleFrame(bubble, 0).text, '👩🏽‍💻')
  assert.equal(typedBubbleFrame(bubble, 34).text, '👩🏽‍💻a')
  assert.deepEqual(splitGraphemes('é👩🏽‍💻', false), ['é', '👩🏽‍💻'])
  const boundary = bubbleFor(note(`${'a'.repeat(29)}👩🏽‍💻b`), 0, 120)!
  assert.equal(typedBubbleFrame(boundary, boundary.expiresAt - 1, 30, 2, text => splitGraphemes(text).length).text.split('\n')[0]?.endsWith('👩🏽‍💻'), true)
  assert.deepEqual(wrapLines('WW\niii', 4, text => [...text].length * 2), ['WW', 'ii', 'i'])
})

test('short and long excerpts stay through typing and reading, with long text longer', () => {
  assert.equal(bubbleDuration(120, 5), 5_000)
  assert.ok(bubbleDuration(120, 200) >= 9_000)
  assert.ok(bubbleDuration(60, 200) > bubbleDuration(120, 200))
  assert.ok(bubbleDuration(300, 200) < bubbleDuration(120, 200))
})

test('a bubble reveals exact recorded characters then scrolls bounded lines', () => {
  const text = 'one two three four five six seven eight nine ten eleven twelve'
  const bubble = bubbleFor(note(text, 3, true), 1_000, 120)!
  assert.equal(typedBubbleFrame(bubble, 999, 8, 2, text => text.length).text, '')
  assert.equal(typedBubbleFrame(bubble, 1_000, 8, 2, text => text.length).text, 'o')
  const complete = typedBubbleFrame(bubble, bubble.expiresAt - 1, 8, 2, text => text.length)
  assert.equal(complete.complete, true)
  assert.equal(complete.cut, true)
  assert.ok(complete.firstLine > 0)
  assert.equal(complete.text.split('\n').length, 2)
  assert.equal(bubble.text, text)
  assert.equal(typedBubbleFrame(bubbleFor(note('one\ntwo'), 0)!, 10_000).revealed, 'one\ntwo')
})

test('asking and telling shapes require the verified id and name', () => {
  const places: ReplayPlace[] = [
    { id: 249, name: 'the asking room', parent_id: 2, owner: null, owner_id: null, quiet: false, has_drawing: false },
    { id: 422, name: 'the telling room', parent_id: 2, owner: null, owner_id: null, quiet: false, has_drawing: false },
  ]
  assert.equal(bubbleShape(249, places), 'asking')
  assert.equal(bubbleShape(422, places), 'telling')
  assert.equal(bubbleShape(249, [{ ...places[0]!, name: 'renamed' }]), 'plain')
  assert.equal(bubbleShape(3, places), 'plain')
})

test('all bubble backgrounds and tails are opaque pixel rectangles', () => {
  for (const shape of ['plain', 'asking', 'telling'] as const) {
    const cells = bubbleRects(shape, 120, 60)
    assert.ok(cells.length > 0)
    assert.ok(cells.every(cell => Number.isInteger(cell.x) && Number.isInteger(cell.y)
      && Number.isInteger(cell.width) && Number.isInteger(cell.height) && cell.alpha === 1))
    if (shape === 'asking') assert.ok(cells.some(cell => cell.y >= 60))
    if (shape === 'plain') assert.equal(Math.max(...cells.map(cell => cell.y + cell.height)), 60)
    if (shape === 'telling') assert.equal(Math.max(...cells.map(cell => cell.y + cell.height)), 60)
  }
})
