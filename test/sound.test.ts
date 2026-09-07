import assert from 'node:assert/strict'
import test from 'node:test'
import { createSoundState, soundFrame, soundRecipe } from '../src/sound.ts'

const input = (overrides: Record<string, unknown> = {}) => ({ enabled: true, trusted: true, paused: false, now: 0,
  residents: [], activeFoundings: [], ...overrides })

test('old bubbles and founding completions are consumed while sound is off', () => {
  let frame = soundFrame(createSoundState(), input({ enabled: false, residents: [{ id: 1, walkKey: null, walkElapsed: 0,
    bubbleKey: 'note:1', drawn: true, onCamera: true }], activeFoundings: [{ key: 'place:1', endsAt: 5, drawn: true, onCamera: true }] }))
  assert.deepEqual(frame.cues, [])
  frame = soundFrame(frame.state, input({ residents: [{ id: 1, walkKey: null, walkElapsed: 0,
    bubbleKey: 'note:1', drawn: true, onCamera: true }], activeFoundings: [] }))
  assert.deepEqual(frame.cues, [])
})

test('walking emits one bounded shared step cadence only when drawn on camera', () => {
  let frame = soundFrame(createSoundState(), input({ residents: [
    { id: 1, walkKey: 'walk:1', walkElapsed: 0, bubbleKey: null, drawn: true, onCamera: true },
    { id: 2, walkKey: 'walk:2', walkElapsed: 0, bubbleKey: null, drawn: true, onCamera: true }] }))
  assert.deepEqual(frame.cues.map(cue => cue.kind), ['step'])
  frame = soundFrame(frame.state, input({ now: 200, residents: [{ id: 1, walkKey: 'walk:1', walkElapsed: 200,
    bubbleKey: null, drawn: true, onCamera: true }] }))
  assert.deepEqual(frame.cues, [])
  frame = soundFrame(frame.state, input({ now: 450, residents: [{ id: 1, walkKey: 'walk:1', walkElapsed: 450,
    bubbleKey: null, drawn: false, onCamera: true }] }))
  assert.deepEqual(frame.cues, [])
})

test('new visible bubbles pop once and real founding completion chimes once', () => {
  let frame = soundFrame(createSoundState(), input({ residents: [{ id: 1, walkKey: null, walkElapsed: 0,
    bubbleKey: 'note:1', drawn: true, onCamera: true }], activeFoundings: [{ key: 'found:1', endsAt: 5, drawn: true, onCamera: true }] }))
  assert.deepEqual(frame.cues.map(cue => cue.kind), ['pop'])
  frame = soundFrame(frame.state, input({ now: 10, residents: [], activeFoundings: [] }))
  assert.deepEqual(frame.cues.map(cue => cue.kind), ['chime'])
  assert.deepEqual(soundFrame(frame.state, input({ now: 20 })).cues, [])
})

test('untrusted, paused, hidden and offscreen frames stay silent', () => {
  for (const changes of [{ trusted: false }, { paused: true }, { residents: [{ id: 1, walkKey: null, walkElapsed: 0,
    bubbleKey: 'n', drawn: false, onCamera: true }] }, { residents: [{ id: 1, walkKey: null, walkElapsed: 0,
    bubbleKey: 'n', drawn: true, onCamera: false }] }]) assert.deepEqual(soundFrame(createSoundState(), input(changes)).cues, [])
})

test('recipes are short quiet synthesized tones', () => {
  for (const kind of ['step', 'pop', 'chime'] as const) for (const tone of soundRecipe(kind)) {
    assert.ok(tone.gain > 0 && tone.gain <= 0.035)
    assert.ok(tone.duration > 0 && tone.duration <= 0.22)
  }
})
