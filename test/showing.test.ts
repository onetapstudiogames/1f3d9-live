import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayPlace } from '../src/city/types.ts'
import type { SpeechBubble } from '../src/speech.ts'
import { ballotCells, confettiCells, showingFor, showingFrame, spotlightCells } from '../src/showing.ts'

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
