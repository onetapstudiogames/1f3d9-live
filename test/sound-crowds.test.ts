import assert from 'node:assert/strict'
import test from 'node:test'
import { createSoundState, soundFrame } from '../src/sound.ts'

const residents = [1, 2].map(id => ({ id, walkKey: `walk:${id}`, walkElapsed: 0,
  bubbleKey: `note:${id}`, drawn: true, onCamera: true }))
const frame = { enabled: true, trusted: true, now: 0, residents,
  activeFoundings: [1, 2].map(id => ({ key: `founding:${id}`, endsAt: 100, drawn: true, onCamera: true })) }

test('simultaneous visible events share a pop, a step, and a founding chime', () => {
  const initial = soundFrame(createSoundState(), frame)
  assert.deepEqual(initial.cues.map(cue => cue.kind), ['pop', 'step'])
  const completed = soundFrame(initial.state, { ...frame, now: 500, activeFoundings: [],
    residents: residents.map(row => ({ ...row, bubbleKey: `${row.bubbleKey}:new`, walkElapsed: 500 })) })
  assert.deepEqual(completed.cues.map(cue => cue.kind), ['pop', 'step', 'chime'])
})

test('long listening history keeps only each resident’s latest note identity', () => {
  let state = createSoundState()
  for (let index = 0; index < 1_000; index += 1) {
    state = soundFrame(state, { ...frame, now: index * 500, activeFoundings: [],
      residents: residents.map(row => ({ ...row, walkKey: null, bubbleKey: `${row.id}:${index}` })) }).state
  }
  assert.equal(state.bubbles.size, 2)
  assert.equal(state.walkTicks.size, 0)
  assert.equal(state.foundings.size, 0)
})
