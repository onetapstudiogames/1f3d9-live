import assert from 'node:assert/strict'
import test from 'node:test'

import { pauseAdvance, speechPauseAt } from '../src/speech-pause.ts'
import { pagedBubbleFrame, type SpeechBubble, type SpeechPageMoment } from '../src/speech.ts'

const bubble = (text: string): SpeechBubble => ({ text, cut: false, placeId: 3, startedAt: 1_000, charInterval: 100, expiresAt: 5_000 })
const page = (lines: readonly string[], start = 1_000, revealEnd = 3_000, end = 4_000): SpeechPageMoment => ({ lines, start, revealEnd, end })

test('pause finishes the current sentence when it ends before the display line', () => {
  const current = bubble('Hi there. More words')
  const plan = [page(['Hi there. More words'])]
  const target = speechPauseAt(current, plan, 1_300)
  assert.equal(target, 1_800)
  assert.equal(pagedBubbleFrame(current, target, 320, 200, text => text.length, plan).revealed, 'Hi there.')
})

test('sentence punctuation includes closing quotes and ignores decimal points', () => {
  const text = 'Value 3.2 units. Later'
  assert.equal(speechPauseAt(bubble(text), [page([text], 1_000, 3_200)], 1_500), 2_500)
})

test('short capitalized abbreviations do not end a sentence', () => {
  for (const abbreviation of ['Dr.', 'Jr.', 'Mr.', 'Mrs.', 'Ms.', 'Sr.', 'St.']) {
    const text = `${abbreviation} Smith walked home. Later`
    const plan = [page([text], 1_000, 1_000 + text.length * 100)]
    const target = speechPauseAt(bubble(text), plan, 1_000)
    assert.equal(
      pagedBubbleFrame(bubble(text), target, 320, 200, value => value.length, plan).revealed,
      `${abbreviation} Smith walked home.`,
    )
  }
})

test('ordinary short capitalized words still end sentences', () => {
  const text = 'Go. Walk home.'
  const plan = [page([text], 1_000, 1_000 + text.length * 100)]
  const target = speechPauseAt(bubble(text), plan, 1_000)
  assert.equal(pagedBubbleFrame(bubble(text), target, 320, 200, value => value.length, plan).revealed, 'Go.')
})

test('internal-dot abbreviations do not end a sentence', () => {
  for (const [text, sentence] of [
    ['Meet at 9 a.m. tomorrow. Later', 'Meet at 9 a.m. tomorrow.'],
    ['The U.S. team arrived. Later', 'The U.S. team arrived.'],
  ] as const) {
    const plan = [page([text], 1_000, 1_000 + text.length * 100)]
    const target = speechPauseAt(bubble(text), plan, 1_000)
    assert.equal(
      pagedBubbleFrame(bubble(text), target, 320, 200, value => value.length, plan).revealed,
      sentence,
    )
  }
})

test('Unicode sentence punctuation completes a sentence', () => {
  assert.equal(speechPauseAt(bubble('秋風や。次へ'), [page(['秋風や。次へ'], 1_000, 1_700)], 1_000), 1_000 + 700 * 3 / 6)
})

test('pause finishes the measured current display line', () => {
  assert.equal(speechPauseAt(bubble('alpha beta gamma'), [page(['alpha beta ', 'gamma'])], 1_200), 2_250)
})

test('explicit newlines complete the current line', () => {
  assert.equal(speechPauseAt(bubble('hello\nworld'), [page(['hello\n', 'world'], 1_000, 2_100)], 1_100), 1_500)
})

test('pause timing counts Unicode graphemes rather than UTF-16 units', () => {
  assert.equal(speechPauseAt(bubble('👩🏽‍💻 ok. Later'), [page(['👩🏽‍💻 ok. Later'], 1_000, 2_100)], 1_000), 1_400)
})

test('a page boundary is bounded by reveal and hold end', () => {
  const plan = [page(['unfinished'], 1_000, 1_800, 2_500), page(['next.'], 2_500, 3_000, 4_000)]
  assert.equal(speechPauseAt(bubble('unfinishednext.'), plan, 1_700), 1_720)
  assert.equal(speechPauseAt(bubble('unfinishednext.'), plan, 1_900), 1_900)
})

test('no current bubble, missing plan, and completed pages pause now', () => {
  assert.equal(speechPauseAt(null, [page(['hello'])], 1_200), 1_200)
  assert.equal(speechPauseAt(bubble('hello'), [], 1_200), 1_200)
  assert.equal(speechPauseAt(bubble('hello'), [page(['hello'], 1_000, 1_500, 2_000)], 1_500), 1_500)
})

test('pauseAdvance lands exactly on a crossed deadline', () => {
  assert.deepEqual(pauseAdvance(20, 100, 110), { delta: 10, paused: true })
  assert.deepEqual(pauseAdvance(10, 100, 110), { delta: 10, paused: true })
})

test('pauseAdvance continues before a deadline and passes through no deadline', () => {
  assert.deepEqual(pauseAdvance(9, 100, 110), { delta: 9, paused: false })
  assert.deepEqual(pauseAdvance(20, 100, null), { delta: 20, paused: false })
})

test('pauseAdvance stops with zero delta at an already reached deadline', () => {
  assert.deepEqual(pauseAdvance(20, 110, 110), { delta: 0, paused: true })
})
