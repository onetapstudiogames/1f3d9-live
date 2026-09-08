import assert from 'node:assert/strict'
import test from 'node:test'

import { bubbleDuration, bubbleFitScale, bubbleFor, bubbleRects, bubbleShape, growingBubbleFrame, splitGraphemes, typingInterval, typedBubbleFrame, wrapLines } from '../src/speech.ts'
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
  assert.equal(typedBubbleFrame(boundary, boundary.expiresAt - 1, 30, 2, text => splitGraphemes(text).length).text,
    `${'a'.repeat(29)}👩🏽‍💻b`)
  assert.deepEqual(wrapLines('WW\niii', 4, text => [...text].length * 2), ['WW', 'iii'])
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

test('the renderer can wrap with the actual font width without losing wide recorded characters', () => {
  const text = 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW👩🏽‍💻界'
  const measure = (value: string): number => splitGraphemes(value).reduce((sum, char) => sum + (char === 'W' ? 13 : 18), 0)
  const bubble = bubbleFor(note(text), 0)!
  const frame = typedBubbleFrame(bubble, bubble.expiresAt - 1, 210, 4, measure)
  assert.equal(frame.text.replaceAll('\n', ''), text)
  const lines = frame.text.split('\n')
  const fit = bubbleFitScale(lines, 210, measure)
  assert.ok(lines.every(line => measure(line) * fit <= 210))
})

test('soft wrapping keeps whole words and every recorded character', () => {
  const lines = wrapLines('whole words stay together', 11, text => text.length)
  assert.deepEqual(lines, ['whole words', ' stay', ' together'])
  assert.equal(lines.join(''), 'whole words stay together')
  assert.ok(lines.every(line => !['whol', 'word', 'togeth'].includes(line.trim())))
})

test('one unbreakable token stays whole and is fitted instead of split', () => {
  const token = 'https://city.example/one-very-long-unbreakable-token'
  const lines = wrapLines(token, 20, text => text.length)
  assert.deepEqual(lines, [token])
  assert.equal(bubbleFitScale(lines, 20, text => text.length), 20 / token.length)
  assert.equal(bubbleFitScale(['ordinary words'], 20, text => text.length), 1)
})

test('a growing bubble keeps every revealed line and grows by one fixed line height', () => {
  const bubble = bubbleFor(note('one two three four'), 0, 120)!
  const measure = (text: string): number => splitGraphemes(text).length * 8
  const early = growingBubbleFrame({ ...bubble, charInterval: 1 }, 6, 64, measure)
  const later = growingBubbleFrame({ ...bubble, charInterval: 1 }, 10, 64, measure)
  assert.equal(early.fontSize, 14)
  assert.equal(early.lineHeight, 20)
  assert.equal(early.width, 64)
  assert.equal(early.text, early.revealed)
  assert.ok(later.text.startsWith(early.text))
  assert.ok(later.lines.length > early.lines.length)
  assert.equal(later.height - early.height, 20)
})

test('a growing bubble breaks oversized tokens by grapheme without losing Unicode', () => {
  const text = `ab👩🏽‍💻cdefghijklmnop`
  const bubble = { ...bubbleFor(note(text), 0)!, charInterval: 1 }
  const frame = growingBubbleFrame(bubble, 10_000, 48, value => splitGraphemes(value).length * 8)
  assert.equal(frame.complete, true)
  assert.equal(frame.lines.join(''), text)
  assert.ok(frame.lines.length > 1)
  assert.ok(frame.lines.every(line => splitGraphemes(line).length <= 3))
})

test('a growing bubble preserves explicit newlines and whitespace', () => {
  const text = 'first line\n\n  indented  words\nlast '
  const bubble = { ...bubbleFor(note(text), 0)!, charInterval: 1 }
  const frame = growingBubbleFrame(bubble, 10_000, 320, value => splitGraphemes(value).length * 8)
  assert.equal(frame.text, text)
  assert.deepEqual(frame.lines, ['first line', '', '  indented  words', 'last '])
  assert.equal(frame.width, 320)
  assert.equal(frame.height, 100)
})

test('full note length extends the existing typing and reading duration', () => {
  const short = bubbleFor(note('brief'), 0)!
  const full = bubbleFor(note(`brief\n${'x'.repeat(500)}`), 0)!
  assert.ok(full.expiresAt > short.expiresAt)
  assert.ok(full.expiresAt >= splitGraphemes(full.text).length * full.charInterval + 2_500)
})

test('typing a long word never reduces the growing card height', () => {
  const text = `short ${'界'.repeat(80)} after\nlast`
  const original = bubbleFor(note(text), 0)!
  const bubble = { ...original, charInterval: 1 }
  const heights = splitGraphemes(text).map((_, index) =>
    growingBubbleFrame(bubble, index, 96, value => splitGraphemes(value).length * 8).height)
  assert.ok(heights.every((height, index) => index === 0 || height >= heights[index - 1]!))
  assert.equal(growingBubbleFrame(bubble, 10_000, 96, value => splitGraphemes(value).length * 8).text, text)
})
