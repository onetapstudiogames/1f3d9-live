import assert from 'node:assert/strict'
import test from 'node:test'
import { pauseAdvance, speechPauseAt } from '../src/speech-pause.ts'
import { speechCardFrame, speechCardPlan, type SpeechBubble } from '../src/speech.ts'
const bubble = (text: string): SpeechBubble => ({ text, cut: false, placeId: 3, startedAt: 1_000, charInterval: 100, expiresAt: 8_000 })
const measure = (text: string): number => [...text].length

test('pause finishes the current sentence before the measured line', () => {
  const current = bubble('Hi there. More words'); const plan = speechCardPlan(current, 320, measure)
  assert.equal(speechCardFrame(current, speechPauseAt(current, plan, 1_300), 320, 200, measure, plan).revealed, 'Hi there.')
})
test('pause uses measured whole lines and explicit newlines without leaking the next grapheme', () => {
  const wrapped = bubble('alpha beta gamma'); const wrappedPlan = speechCardPlan(wrapped, 12, measure)
  assert.equal(speechCardFrame(wrapped, speechPauseAt(wrapped, wrappedPlan, 1_200), 36, 200, measure, wrappedPlan).revealed, 'alpha ')
  const explicit = bubble('hello\nworld'); const explicitPlan = speechCardPlan(explicit, 320, measure)
  assert.equal(speechCardFrame(explicit, speechPauseAt(explicit, explicitPlan, 1_100), 320, 200, measure, explicitPlan).revealed, 'hello\n')
})
test('short capitalized title abbreviations do not end a sentence', () => {
  for (const abbreviation of ['Dr.', 'Jr.', 'Mr.', 'Mrs.', 'Ms.', 'Sr.', 'St.']) {
    const text = `${abbreviation} Smith walked home. Later`
    const current = bubble(text)
    const plan = speechCardPlan(current, 320, measure)
    assert.equal(speechCardFrame(current, speechPauseAt(current, plan, 1_000), 320, 200, measure, plan).revealed,
      `${abbreviation} Smith walked home.`)
  }
})

test('an ordinary short capitalized word still ends a sentence', () => {
  const current = bubble('Go. Walk home.')
  const plan = speechCardPlan(current, 320, measure)
  assert.equal(speechCardFrame(current, speechPauseAt(current, plan, 1_000), 320, 200, measure, plan).revealed, 'Go.')
})

test('internal-dot abbreviations do not end a sentence', () => {
  for (const [text, sentence] of [
    ['Meet at 9 a.m. tomorrow. Later', 'Meet at 9 a.m. tomorrow.'],
    ['The U.S. team arrived. Later', 'The U.S. team arrived.'],
  ] as const) {
    const current = bubble(text); const plan = speechCardPlan(current, 320, measure)
    assert.equal(speechCardFrame(current, speechPauseAt(current, plan, 1_000), 320, 200, measure, plan).revealed, sentence)
  }
})

test('decimal points do not end a sentence', () => {
  const current = bubble('Value 3.2 units. Later')
  const plan = speechCardPlan(current, 320, measure)
  assert.equal(speechCardFrame(current, speechPauseAt(current, plan, 1_000), 320, 200, measure, plan).revealed,
    'Value 3.2 units.')
})

test('Unicode sentence punctuation completes a sentence', () => {
  const current = bubble('秋風や。次へ')
  const plan = speechCardPlan(current, 320, measure)
  assert.equal(speechCardFrame(current, speechPauseAt(current, plan, 1_000), 320, 200, measure, plan).revealed, '秋風や。')
})

test('pause timing counts a joined emoji as one grapheme', () => {
  const current = bubble('👩🏽‍💻 ok. Later')
  const plan = speechCardPlan(current, 320, measure)
  assert.equal(speechCardFrame(current, speechPauseAt(current, plan, 1_000), 320, 200, measure, plan).revealed,
    '👩🏽‍💻 ok.')
})
test('completed, absent, or unplanned speech pauses now', () => {
  const current = bubble('hello'); assert.equal(speechPauseAt(null, speechCardPlan(current), 1_200), 1_200)
  assert.equal(speechPauseAt(current, null, 1_200), 1_200); assert.equal(speechPauseAt(current, speechCardPlan(current), current.expiresAt), current.expiresAt)
})
test('pauseAdvance lands exactly on an armed deadline', () => {
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
