import assert from 'node:assert/strict'
import test from 'node:test'
import { bubbleDuration, bubbleFor, bubbleShape, speechCardFrame, speechCardPlan, speechScrollTop, splitGraphemes, typingInterval } from '../src/speech.ts'
import type { ReplayEvent, ReplayPlace } from '../src/city/types.ts'
const note = (line: string, placeId = 3, cut = false): ReplayEvent => ({ actor: 'ada', at: '2026-01-01T00:00:00Z', change_id: '1', event_id: 1, kind: 'note', detail: { place_id: placeId }, line, line_cut: cut })
const measured = (text: string): number => splitGraphemes(text).length * 8

test('card wrapping uses the measured text width after the scrollbar gutter', () => {
  const bubble = bubbleFor(note('one two three four five six'), 0)!
  const plan = speechCardPlan(bubble, 320, measured, 80)
  assert.equal(plan.lineWidth, 80)
  assert.ok(plan.lines.every(line => measured(line.trimEnd()) <= 80))
  const frame = speechCardFrame(bubble, bubble.expiresAt - 1, 320, 60, measured, plan)
  assert.equal(frame.width, 240)
  assert.deepEqual(frame.lines, plan.lines)
})

test('scrolling reaches the measured last line and stays zero for fitting text', () => {
  assert.equal(speechScrollTop(740, 440), 300)
  assert.equal(speechScrollTop(40, 100), 0)
  assert.equal(speechScrollTop(100, 100), 0)
})

test('typing has one live pace, long notes cap at fifteen seconds, and completed text holds', () => {
  assert.equal(typingInterval(), 68)
  assert.equal(bubbleDuration(5), 10_000); assert.equal(bubbleDuration(50_000), 15_000)
  const bubble = bubbleFor(note('brief'), 1_000)!; const plan = speechCardPlan(bubble, 320, measured)
  assert.equal(plan.revealEnd - plan.start, 5 * bubble.charInterval); assert.ok(plan.end - plan.revealEnd >= 2_500)
})

test('one continuous card types every grapheme once and retains the whole recorded body', () => {
  const text = `first line\n\n  indented  words\n${'界'.repeat(80)} 👩🏽‍💻`
  const bubble = { ...bubbleFor(note(text, 3, true), 1_000)!, charInterval: 1 }
  assert.equal(speechCardFrame(bubble, 999, 96, 100, measured).text, '')
  assert.equal(speechCardFrame(bubble, 1_000, 96, 100, measured).text, 'f')
  const complete = speechCardFrame(bubble, bubble.expiresAt - 1, 96, 100, measured)
  assert.equal(complete.revealed, text); assert.equal(complete.text, text); assert.equal(complete.complete, true)
  assert.equal(complete.cut, true); assert.equal(complete.lines.join(''), text)
  assert.deepEqual(splitGraphemes('é👩🏽‍💻', false), ['é', '👩🏽‍💻'])
})

test('the first typed frame reveals one complete Unicode grapheme', () => {
  const bubble = bubbleFor(note('👩🏽‍💻a'), 0)!
  assert.equal(speechCardFrame(bubble, 0).revealed, '👩🏽‍💻')
  assert.equal(speechCardFrame(bubble, bubble.expiresAt - 1).revealed, '👩🏽‍💻a')
})

test('a fifty-thousand-grapheme note types by 12.5 seconds and holds for 2.5 seconds', () => {
  const text = 'a'.repeat(50_000)
  const bubble = bubbleFor(note(text), 0)!
  const plan = speechCardPlan(bubble, 320, measured)
  assert.equal(bubble.expiresAt, 15_000)
  assert.equal(plan.revealEnd, 12_500)
  assert.equal(plan.end - plan.revealEnd, 2_500)
  assert.equal(speechCardFrame(bubble, 12_499, 320, 200, measured, plan).complete, false)
  const held = speechCardFrame(bubble, 12_500, 320, 200, measured, plan)
  assert.equal(held.complete, true)
  assert.equal(held.revealed, text)
  assert.equal(speechCardFrame(bubble, 14_999, 320, 200, measured, plan).revealed, text)
})

test('an oversized token wraps by complete grapheme within the measured line width', () => {
  const text = `ab👩🏽‍💻cdefghijklmnop`
  const bubble = { ...bubbleFor(note(text), 0)!, charInterval: 1 }
  const frame = speechCardFrame(bubble, bubble.expiresAt - 1, 48, 100, measured)
  assert.equal(frame.revealed, text)
  assert.equal(frame.lines.join(''), text)
  assert.ok(frame.lines.every(line => splitGraphemes(line).length <= 3))
})

test('explicit newlines, blank lines, indentation, and trailing spaces remain exact', () => {
  const text = 'first line\n\n  indented  words\nlast '
  const bubble = { ...bubbleFor(note(text), 0)!, charInterval: 1 }
  const frame = speechCardFrame(bubble, bubble.expiresAt - 1, 320, 100, measured)
  assert.equal(frame.revealed, text)
  assert.deepEqual(frame.lines, ['first line\n', '\n', '  indented  words\n', 'last '])
})

test('a recorded trailing newline does not invent or lose text', () => {
  const text = 'a\nb\nc\nd\n'
  const bubble = bubbleFor(note(text), 0)!
  const plan = speechCardPlan(bubble, 320, measured)
  assert.equal(plan.lines.join(''), text)
  assert.equal(speechCardFrame(bubble, bubble.expiresAt - 1, 320, 60, measured, plan).revealed, text)
})

test('card has its final capped height from the start, then scrolls upward as lines arrive', () => {
  const bubble = { ...bubbleFor(note('one two three four five six seven eight'), 0)!, charInterval: 1 }
  const frames = [3, 9, 17, 25, 40].map(at => speechCardFrame(bubble, at, 64, 60, measured))
  assert.ok(frames.every(frame => frame.height === frames[0]!.height))
  assert.ok(frames.every(frame => frame.height <= 60)); assert.ok(frames.some(frame => frame.scrollTop > 0))
  const last = frames.at(-1)!; assert.equal(last.scrollTop, Math.max(0, last.contentHeight - last.height))
  assert.equal(last.fontSize, 14); assert.equal(last.lineHeight, 20)
})

test('a long note gets a three-line card even in a tall room, and scrolls through it', () => {
  const bubble = { ...bubbleFor(note('word '.repeat(120)), 0)!, charInterval: 1 }
  const frame = speechCardFrame(bubble, bubble.expiresAt - 1, 320, 600, measured)
  assert.equal(frame.width, 240); assert.equal(frame.height, 10 * 2 + 3 * 20)
  assert.ok(frame.contentHeight > frame.height); assert.equal(frame.scrollTop, frame.contentHeight - frame.height)
})

test('asking and telling shapes require the verified id and name', () => {
  const places: ReplayPlace[] = [{ id: 249, name: 'the asking room', parent_id: 2, owner: null, owner_id: null, quiet: false, has_drawing: false }, { id: 422, name: 'the telling room', parent_id: 2, owner: null, owner_id: null, quiet: false, has_drawing: false }]
  assert.equal(bubbleShape(249, places), 'asking'); assert.equal(bubbleShape(422, places), 'telling')
  assert.equal(bubbleShape(249, [{ ...places[0]!, name: 'renamed' }]), 'plain')
})
