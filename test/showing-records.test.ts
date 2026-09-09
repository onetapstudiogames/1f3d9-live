import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ReplayEvent, ReplayFile, ReplayPlace, Resident } from '../src/city/types.ts'
import { bubbleFor } from '../src/speech.ts'
import { showingFor, showingFrame } from '../src/showing.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { createResidents, stepResidents } from '../src/replay/simulation.ts'
import { settleRecordedScene } from './helpers/recorded-scene.ts'

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const places = read('replay-24h.json').map.places as ReplayPlace[]
const notes = read('notes-showing-room.json').notes as Array<{ id: number; author: string; place_id: number; body: string }>
const events = read('events-showing-room.json').events as Array<ReplayEvent & { id: number }>
const founderEvents = read('events-showing-founder.json').events as Array<ReplayEvent & { id: number }>

function noteBubble(note: typeof notes[number]) {
  const notice = [...events, ...founderEvents].find(event => event.detail.note_id === note.id)!
  assert.ok(notice, `saved notice for note ${note.id}`)
  assert.equal(notice.actor, note.author)
  assert.equal(notice.detail.place_id, note.place_id)
  const line = note.body.split('\n')[0]!.slice(0, 200)
  return bubbleFor({ ...notice, event_id: notice.id, line, line_cut: line.length < note.body.length }, 0)!
}

test('the saved showing-room posts distinguish authored VOTE notes from corrections and ordinary prose', () => {
  const map = read('map-showing-room.json').place
  assert.equal(map.id, 438)
  assert.equal(map.name, 'the showing room')
  assert.equal(map.quiet, false)
  assert.equal(map.owner, 'founder')
  assert.equal(notes.length, 50)
  assert.equal(read('notes-showing-room.json').has_more, true)
  const marked = notes.flatMap(note => {
    const bubble = noteBubble(note)
    const moment = showingFor(bubble, true, places, note.author)
    assert.ok(moment, `ordinary spotlight for note ${note.id}`)
    assert.equal(moment.confetti, false)
    assert.equal(moment.expiresAt, bubble.expiresAt, 'adds no replay hold')
    assert.equal(showingFrame(moment, bubble.expiresAt), null)
    return moment.ballot ? [note.id] : []
  })
  assert.deepEqual(marked, [13274, 13141, 12996, 12617, 11835, 11206, 11148, 11119, 11011, 11000, 10990])
  // These are authored posts, not a contest tally. Corrections and the inline mention
  // in ephemeris's 11014 remain ordinary notes, without deciding whether any vote counts.
  for (const id of [13275, 12997, 12713, 12695, 11014]) {
    const note = notes.find(note => note.id === id)!
    assert.equal(showingFor(noteBubble(note), true, places, note.author)?.ballot, false)
  }
})

test('only the exact verified publication gets confetti, never its correction or a copied heading', () => {
  const count = read('notes/note-10059.json').note
  const correction = read('notes/note-10065.json').note
  const bubble = noteBubble(count)
  assert.equal(showingFor(bubble, true, places, count.author)?.confetti, true)
  assert.equal(showingFor(noteBubble(correction), true, places, correction.author)?.confetti, false)
  assert.equal(showingFor(bubble, true, places, 'somebody-else')?.confetti, false)
  assert.equal(showingFor({ ...bubble, noteId: 10060 }, true, places, count.author)?.confetti, false)
  assert.equal(showingFor({ ...bubble, text: 'A different count' }, true, places, count.author)?.confetti, false)
  assert.equal(showingFor(bubble, false, places, count.author), null)
})

test('all showing-room evidence is the same whole answer in the test and browser fixture trees', () => {
  const files = ['map-showing-room.json', 'places/place-438.json', 'events-showing-room.json',
    'events-showing-founder.json', 'notes-showing-room.json',
    ...[6612, 8578, 10059, 10060, 10065, 10203, 10956].map(id => `notes/note-${id}.json`)]
  for (const file of files) assert.deepEqual(readFileSync(new URL(`./fixtures/${file}`, import.meta.url)),
    readFileSync(new URL(`../public/fixtures/${file}`, import.meta.url)), file)
})

test('farlight reaches the recorded room before the vote effect, and opening now drains it', () => {
  const move = events.find(event => event.change_id === '100300')!
  const notice = events.find(event => event.change_id === '100301')!
  const note = notes.find(note => note.id === 13274)!
  assert.equal(move.detail.to_place_id, 438)
  assert.equal(move.actor, notice.actor)
  const vote = { ...notice, event_id: notice.id, line: note.body.split('\n')[0], line_cut: true }
  const census = ([...read('residents-presence-page1.json').residents, ...read('residents-presence-page2.json').residents] as Resident[])
    .find(resident => resident.handle === 'farlight')!
  assert.ok(census)
  assert.ok(census.handle)
  const layout = nestedLayout(places, { 2: 4, 438: 4 })
  // This unit starts at the actual move's recorded source; no browser replay is assembled.
  const record: ReplayFile = { span: '24h', window_start: move.at, window_end: notice.at, checkpoint: notice.change_id,
    complete: true, row_ceiling: 2, map: { places }, counts: {},
    start: { [`resident:${census.id}`]: { place_id: move.detail.from_place_id as number } },
    timeline: [{ ...move, event_id: move.id }, vote] }
  let state = stepResidents(createResidents(record, [census], layout), record.timeline, 0, 0, layout)
  assert.equal(state.residents[census.id]!.walking, true)
  assert.equal(showingFor(state.residents[census.id]!.bubble, true, places, census.handle), null)
  const arrivalAt = state.residents[census.id]!.walkDuration
  state = stepResidents(state, [], arrivalAt, arrivalAt, layout)
  const resident = state.residents[census.id]!
  assert.equal(resident.placeId, 438)
  assert.equal(showingFor(resident.bubble, resident.visible, places, resident.handle)?.ballot, true)
  const settled = settleRecordedScene(record, [census], layout)
  assert.equal(settled.residents.pending, false)
  assert.equal(showingFor(settled.residents.residents[census.id]!.bubble, true, places, census.handle), null)

  // The unchanged public notice has no line. A failed body read must not erase its
  // recorded author and room, or invent a VOTE from a previous successful read.
  const referenceOnly = { ...record, timeline: [{ ...move, event_id: move.id }, { ...notice, event_id: notice.id }] }
  let unread = stepResidents(createResidents(referenceOnly, [census], layout), referenceOnly.timeline, 0, 0, layout)
  const unreadArrivalAt = unread.residents[census.id]!.walkDuration
  unread = stepResidents(unread, [], unreadArrivalAt, unreadArrivalAt, layout)
  const unreadResident = unread.residents[census.id]!
  assert.equal(unreadResident.bubble, null)
  assert.ok(unreadResident.showingNotice)
  assert.equal(unreadResident.showingNotice.ballot, false)
  assert.equal(unreadResident.showingNotice.confetti, false)
  assert.ok(showingFrame(unreadResident.showingNotice, unreadArrivalAt + 1_000))
  assert.equal(unread.pending, true)
  const settledUnread = settleRecordedScene(referenceOnly, [census], layout)
  assert.equal(settledUnread.residents.pending, false)
  assert.equal(settledUnread.residents.residents[census.id]!.showingNotice ?? null, null)
})
