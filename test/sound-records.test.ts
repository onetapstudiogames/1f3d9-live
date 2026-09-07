import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ReplayFile, Resident } from '../src/city/types.ts'
import { bubbleFor, appliedMove } from '../src/replay/index.ts'
import { createSoundState, soundFrame } from '../src/sound.ts'
import { planPlaces } from '../src/places.ts'
import { placeAnimation } from '../src/place-animation.ts'

const replay = JSON.parse(readFileSync(new URL('fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
const census = [1, 2].flatMap(page => (JSON.parse(readFileSync(new URL(
  `fixtures/residents-presence-page${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)
const note = replay.timeline.find(row => row.change_id === '98191')!
const residentId = census.find(row => row.handle === note.actor)!.id
const bubble = bubbleFor(note, 100)!
const resident = { id: residentId, walkKey: null, walkElapsed: 0, bubbleKey: String(bubble.noteId), drawn: true, onCamera: true }
const frame = { enabled: true, trusted: true, paused: false, now: 100, residents: [resident], activeFoundings: [] }

test('an actual recorded excerpt pops once while its typing and scrolling continue', () => {
  assert.equal(bubble.noteId, 12917)
  assert.equal(bubble.text, note.line)
  const first = soundFrame(createSoundState(), frame)
  assert.deepEqual(first.cues.map(cue => cue.kind), ['pop'])
  for (const now of [134, 1_000, bubble.expiresAt - 1]) {
    assert.deepEqual(soundFrame(first.state, { ...frame, now }).cues, [])
  }
})

test('a real note opening while silent never pops later on unmute, resume, reveal, or pan', () => {
  const silentFrames = [
    { ...frame, enabled: false }, { ...frame, trusted: false }, { ...frame, paused: true },
    { ...frame, residents: [{ ...resident, drawn: false }] },
    { ...frame, residents: [{ ...resident, onCamera: false }] },
  ]
  for (const silent of silentFrames) {
    const consumed = soundFrame(createSoundState(), silent)
    assert.deepEqual(consumed.cues, [])
    assert.deepEqual(soundFrame(consumed.state, { ...frame, now: 1_000 }).cues, [])
  }
})

test('an actual homeward walk has paced footsteps only while its figure is in view', () => {
  const walk = replay.timeline.find(row => row.change_id === '98272')!
  assert.deepEqual(appliedMove(walk), { fromId: 8, toId: 193 })
  const walker = { ...resident, id: census.find(row => row.handle === walk.actor)!.id,
    bubbleKey: null, walkKey: walk.change_id, walkElapsed: 0 }
  const first = soundFrame(createSoundState(), { ...frame, residents: [walker] })
  assert.deepEqual(first.cues.map(cue => cue.kind), ['step'])
  const hidden = soundFrame(first.state, { ...frame, now: 1_100,
    residents: [{ ...walker, walkElapsed: 1_000, onCamera: false }] })
  assert.deepEqual(hidden.cues, [])
  const stopped = soundFrame(hidden.state, { ...frame, now: 2_100,
    residents: [{ ...walker, walkKey: null, walkElapsed: 0 }] })
  assert.deepEqual(stopped.cues, [])
})

test('the real Wrong Hat founding chimes at completion once, without chiming on reset or now load', () => {
  const record = JSON.parse(readFileSync(new URL('fixtures/replay-places.json', import.meta.url), 'utf8')) as ReplayFile
  const founding = planPlaces(record).foundings.get(782)!
  assert.equal(founding.changeId, '99972')
  assert.equal(founding.name, 'The Wrong Hat')
  const animation = placeAnimation('founding', founding.placeId, founding.changeId, 100)
  const active = { key: founding.changeId, endsAt: animation.startedAt + animation.duration, drawn: true, onCamera: true }
  const initial = { ...frame, residents: [], activeFoundings: [active] }
  const running = soundFrame(createSoundState(), initial)
  assert.deepEqual(running.cues, [])
  const done = soundFrame(running.state, { ...initial, now: active.endsAt, activeFoundings: [] })
  assert.deepEqual(done.cues.map(cue => cue.kind), ['chime'])
  assert.deepEqual(soundFrame(done.state, { ...initial, now: active.endsAt + 1, activeFoundings: [] }).cues, [])
  assert.deepEqual(soundFrame(running.state, { ...initial, now: active.endsAt - 1, activeFoundings: [] }).cues, [])
  assert.deepEqual(soundFrame(createSoundState(), { ...initial, now: active.endsAt, activeFoundings: [] }).cues, [])
  const unseen = soundFrame(createSoundState(), { ...initial, activeFoundings: [{ ...active, drawn: false }] })
  assert.deepEqual(soundFrame(unseen.state, { ...initial, now: active.endsAt, activeFoundings: [] }).cues, [])
  const muted = soundFrame(running.state, { ...initial, enabled: false, now: active.endsAt, activeFoundings: [] })
  assert.deepEqual(muted.cues, [])
  assert.deepEqual(soundFrame(muted.state, { ...initial, now: active.endsAt + 1, activeFoundings: [] }).cues, [])
})
