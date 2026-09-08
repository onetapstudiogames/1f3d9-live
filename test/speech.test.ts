import assert from 'node:assert/strict'
import test from 'node:test'

import { bubbleDuration, bubbleFor, bubbleShape, pagedBubbleFrame, speechPagePlan, splitGraphemes, typingInterval } from '../src/speech.ts'
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
  assert.equal(pagedBubbleFrame(bubble, 0).text, '👩🏽‍💻')
  assert.ok(pagedBubbleFrame(bubble, bubble.expiresAt - 1).text.endsWith('a'))
  assert.deepEqual(splitGraphemes('é👩🏽‍💻', false), ['é', '👩🏽‍💻'])
})

test('short notes stay readable and novels cannot park the room', () => {
  assert.equal(bubbleDuration(120, 5), 5_000)
  assert.ok(bubbleDuration(120, 200) >= 9_000)
  assert.equal(bubbleDuration(60, 50_000), 15_000)
  assert.equal(bubbleDuration(120, 50_000), 15_000)
  assert.equal(bubbleDuration(300, 50_000), 15_000)
  assert.ok(bubbleDuration(300, 200) < bubbleDuration(120, 200))
})

test('short notes keep their requested typing pace and spend spare time holding', () => {
  const bubble = bubbleFor(note('brief'), 1_000, 120)!
  const plan = speechPagePlan(bubble, 320, 200)
  assert.equal(plan.length, 1)
  assert.equal(plan[0]!.revealEnd - plan[0]!.start, 5 * bubble.charInterval)
  assert.ok(plan[0]!.revealEnd - plan[0]!.start < 200)
  assert.ok(pagedBubbleFrame(bubble, 1_034, 320, 200).effectiveCharInterval <= bubble.charInterval)
})

test('a bubble reveals exact recorded characters in room-sized pages', () => {
  const text = 'one two three four five six seven eight nine ten eleven twelve'
  const bubble = bubbleFor(note(text, 3, true), 1_000, 120)!
  assert.equal(pagedBubbleFrame(bubble, 999, 32, 60, text => text.length).text, '')
  assert.equal(pagedBubbleFrame(bubble, 1_000, 32, 60, text => text.length).text, 'o')
  const complete = pagedBubbleFrame(bubble, bubble.expiresAt - 1, 32, 60, text => text.length)
  assert.equal(complete.complete, true)
  assert.equal(complete.cut, true)
  assert.ok(complete.page > 0)
  assert.ok(complete.lines.length <= 2)
  assert.equal(complete.pages.flat().join(''), text)
  assert.equal(bubble.text, text)
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

test('a page keeps every revealed line at one fixed reading size', () => {
  const bubble = bubbleFor(note('one two three four'), 0, 120)!
  const measure = (text: string): number => splitGraphemes(text).length * 8
  const early = pagedBubbleFrame(bubble, 100, 64, 100, measure)
  const later = pagedBubbleFrame(bubble, 500, 64, 100, measure)
  assert.equal(early.fontSize, 14)
  assert.equal(early.lineHeight, 20)
  assert.equal(early.width, 64)
  assert.ok(later.revealed.startsWith(early.revealed))
  assert.ok(later.height >= early.height)
})

test('an oversized token breaks by grapheme without losing Unicode', () => {
  const text = `ab👩🏽‍💻cdefghijklmnop`
  const bubble = { ...bubbleFor(note(text), 0)!, charInterval: 1 }
  const frame = pagedBubbleFrame(bubble, bubble.expiresAt - 1, 48, 100, value => splitGraphemes(value).length * 8)
  assert.equal(frame.complete, true)
  assert.equal(frame.pages.flat().join(''), text)
  assert.ok(frame.pages.flat().every(line => splitGraphemes(line).length <= 3))
})

test('paging preserves explicit newlines and whitespace', () => {
  const text = 'first line\n\n  indented  words\nlast '
  const bubble = { ...bubbleFor(note(text), 0)!, charInterval: 1 }
  const frame = pagedBubbleFrame(bubble, bubble.expiresAt - 1, 320, 100, value => splitGraphemes(value).length * 8)
  assert.equal(frame.pages.flat().join(''), text)
  assert.deepEqual(frame.pages, [['first line\n', '\n', '  indented  words\n', 'last ']])
  assert.equal(frame.width, 320)
  assert.equal(frame.height, 100)
})

test('a page ending in a recorded newline does not invent an extra display line', () => {
  const text = 'a\nb\nc\nd\n'
  const bubble = bubbleFor(note(text), 0)!
  const plan = speechPagePlan(bubble, 320, 60, value => value.length * 8)
  assert.equal(plan.flatMap(page => page.lines).join(''), text)
  assert.ok(plan.every(page => page.lines.length <= 2))
  for (const page of plan) {
    const frame = pagedBubbleFrame(bubble, page.revealEnd, 320, 60, value => value.length * 8, plan)
    assert.ok(frame.height <= 60)
  }
})

test('every page completes and holds before the simulation expiry', () => {
  const short = bubbleFor(note('brief'), 0)!
  const full = bubbleFor(note(`brief\n${'word '.repeat(200)}`), 0)!
  const plan = speechPagePlan(full, 320, 220, text => splitGraphemes(text).length * 8)
  assert.ok(full.expiresAt > short.expiresAt)
  assert.ok(plan.length >= 2 && plan.length <= 4)
  assert.ok(plan.every(page => page.revealEnd > page.start && page.end > page.revealEnd))
  assert.ok(plan.every(page => page.end - page.revealEnd >= 2_000))
  assert.equal(plan.at(-1)!.end, full.expiresAt)
  assert.equal(plan.flatMap(page => page.lines).join(''), full.text)
})

test('typing a long word never reduces the current page height', () => {
  const text = `short ${'界'.repeat(80)} after\nlast`
  const original = bubbleFor(note(text), 0)!
  const bubble = { ...original, charInterval: 1 }
  const heights = splitGraphemes(text).map((_, index) =>
    pagedBubbleFrame(bubble, index, 96, 100, value => splitGraphemes(value).length * 8).height)
  assert.ok(heights.every((height, index) => index === 0 || height >= heights[index - 1]!))
  assert.equal(pagedBubbleFrame(bubble, bubble.expiresAt - 1, 96, 100, value => splitGraphemes(value).length * 8).pages.flat().join(''), text)
})
