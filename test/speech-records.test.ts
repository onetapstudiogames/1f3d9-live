import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ReplayFile, ReplayPlace } from '../src/city/types.ts'
import { bubbleFor, bubbleShape, speechCardFrame, speechCardPlan } from '../src/speech.ts'

const read = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const replay = JSON.parse(read('replay-24h.json')) as ReplayFile

test('hard line breaks and empty lines remain visible when no soft wrapping is needed', () => {
  // A unit-only note in the public row shape, never a saved browser response.
  const text = 'left\n\nright\nlast'
  const bubble = bubbleFor({ actor: 'reader', at: '2026-09-07T00:00:00Z', change_id: '1',
    event_id: 1, kind: 'note', detail: { place_id: 3 }, line: text, line_cut: false }, 0)!
  const frame = speechCardFrame(bubble, bubble.expiresAt - 1, 320, 200)
  assert.equal(frame.lines.join(''), text)
  assert.equal(frame.revealed, text)
})

test('public map answers verify both named speech rooms and match the browser fixtures exactly', () => {
  for (const [file, id, name, shape] of [
    ['map-asking-room.json', 249, 'the asking room', 'asking'],
    ['map-telling-room.json', 422, 'the telling room', 'telling'],
  ] as const) {
    const raw = read(file)
    assert.equal(raw, readFileSync(new URL(`../public/fixtures/${file}`, import.meta.url), 'utf8'))
    const { place } = JSON.parse(raw) as { place: ReplayPlace }
    assert.equal(place.id, id)
    assert.equal(place.name, name)
    assert.equal(place.quiet, false)
    assert.equal(bubbleShape(id, [place]), shape)
    assert.equal(bubbleShape(id, [{ ...place, name: 'a later recorded name' }]), 'plain')
  }
})

test('every saved note excerpt survives scrolling typing with its exact words and cut flag', () => {
  const notes = replay.timeline.filter(row => row.kind === 'note' && typeof row.line === 'string' && row.line.length > 0)
  assert.ok(notes.length > 0)
  assert.ok(notes.some(row => row.detail.place_id === 249))
  for (const note of notes) {
    const bubble = bubbleFor(note, 1_000, 120)
    assert.ok(bubble)
    assert.equal(bubble.text, note.line)
    assert.equal(bubble.cut, note.line_cut === true)
    const plan = speechCardPlan(bubble, 320)
    assert.equal(plan.lines.join(''), note.line, `recorded note ${note.event_id}`)
    assert.ok(plan.start < plan.revealEnd && plan.revealEnd < plan.end)
    const final = speechCardFrame(bubble, bubble.expiresAt - 1, 320, 200)
    assert.equal(final.complete, true)
    assert.equal(final.revealed, note.line)
    assert.ok(bubble.expiresAt - bubble.startedAt <= 15_000)
  }
})
