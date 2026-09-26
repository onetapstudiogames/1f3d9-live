import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createNoteExcerptLoader, fetchChanges, fetchRoomLines, parseChangesPage, parseNoteExcerpt, parseRoomLines } from '../src/city/changes.ts'

const feed = JSON.parse(await readFile(new URL('./fixtures/changes-live.json', import.meta.url), 'utf8'))
const note = JSON.parse(await readFile(new URL('./fixtures/notes/note-13243.json', import.meta.url), 'utf8'))
const walkToRead = await readFile(new URL('./fixtures/notes/note-17942.json', import.meta.url), 'utf8')

test('the real changes page keeps order and references without inventing note text', () => {
  const page = parseChangesPage(feed)
  assert.equal(page.marker, '100297')
  assert.equal(page.nextSince, '100297')
  assert.equal(page.hasMore, false)
  assert.equal(page.unchanged, false)
  assert.equal(page.events.length, 174)
  assert.equal(page.events[0]!.change_id, '100124')
  assert.equal(page.events[0]!.at, feed.changes[0].created_at)
  assert.equal(page.events[0]!.event_id, 100124)
  const reference = page.events.find(row => row.change_id === '100128')!
  assert.equal(reference.kind, 'note')
  assert.equal(reference.detail.note_id, 13243)
  assert.equal(reference.line, undefined)
  assert.equal(Object.isFrozen(page.events), true)
  assert.equal(Object.isFrozen(reference.detail), true)
})

test('a changes notice never supplies authored text even if unexpected fields appear', () => {
  const changed = { ...feed, changes: feed.changes.map((row: object) => ({ ...row, line: 'not an excerpt', body: 'not a body' })) }
  assert.ok(parseChangesPage(changed).events.every(row => row.line === undefined))
})

test('invalid or unordered pages fail before the caller can advance its marker', () => {
  const first = feed.changes[0]
  for (const value of [null, {}, { ...feed, change_marker: 'bad' }, { ...feed, next_since: '100298' },
    { ...feed, changes: [feed.changes[1], first] }, { ...feed, changes: [first, first] },
    { ...feed, changes: [{ ...first, created_at: 'bad' }] }, { ...feed, changes: [{ ...first, actor: 3 }] },
    { ...feed, changes: [{ ...first, detail: [] }] }, { ...feed, changes: [{ ...first, kind: '' }] },
    { ...feed, changes: [{ ...first, change_id: '9007199254740992' }] },
    { ...feed, changes: [], has_more: true }, { ...feed, unchanged: true }, { ...feed, has_more: 'yes' }]) {
    assert.throws(() => parseChangesPage(value), /changes/)
  }
  const empty = parseChangesPage({ change_marker: '0', next_since: '0', has_more: false, unchanged: true, changes: [] })
  assert.deepEqual(empty.events, [])
  const paged = parseChangesPage({ ...feed, next_since: first.change_id, has_more: true, changes: [first] })
  assert.equal(paged.hasMore, true)
})

test('changes reads omit credentials and fixture reads never fall back to the city', async t => {
  const original = globalThis.fetch
  const calls: { url: string; options?: RequestInit }[] = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), ...(options ? { options } : {}) })
    return Response.json(feed)
  }
  t.after(() => { globalThis.fetch = original })
  await fetchChanges('100123', '')
  await fetchChanges('100123', '?census=/fixtures/residents-presence-page1.json')
  await fetchChanges('100123', '?census=/saved/census.json&changes=/saved/changes.json')
  assert.deepEqual(calls.map(call => call.url), [
    'https://1f3d9.com/api/changes?since=100123&limit=200', 'fixtures/changes-live.json', '/saved/changes.json',
  ])
  assert.equal(calls[0]!.options?.credentials, 'omit')
  assert.deepEqual(calls[0]!.options?.headers, { accept: 'application/json' })
  assert.ok(calls[0]!.options?.signal instanceof AbortSignal)
  await assert.rejects(fetchChanges('invalid', ''), /marker/)
  globalThis.fetch = async () => new Response('', { status: 503 })
  await assert.rejects(fetchChanges('0', ''), /503/)
  globalThis.fetch = async () => new Response('<html>missing</html>', { headers: { 'content-type': 'text/html' } })
  await assert.rejects(fetchChanges('0', '?census=/fixtures/residents-presence-page1.json'))
})

test('a real single-note read yields its complete body including newlines', () => {
  const excerpt = parseNoteExcerpt(note, 13243)
  assert.deepEqual(excerpt, { id: 13243, author: 'buzz', placeId: 782, text: note.note.body, cut: false })
  const short = { note: { id: 1, author: 'one', place_id: 3, body: 'hello' } }
  assert.equal(parseNoteExcerpt(short, 1).cut, false)
  assert.equal(parseNoteExcerpt({ note: { ...short.note, body: `first\n${'x'.repeat(250)}` } }, 1).text,
    `first\n${'x'.repeat(250)}`)
  for (const value of [null, {}, { note: { ...short.note, id: 2 } }, { note: { ...short.note, place_id: null } },
    { note: { ...short.note, body: 3 } }, { note: { ...short.note, author: null } }]) {
    assert.throws(() => parseNoteExcerpt(value, 1), /note/)
  }
})

test('a walk-to-read note answer keeps its first line and never a body', async () => {
  // Shaped by the city's walk-to-read shaper (city PR #355); not a recorded note.
  assert.equal(walkToRead, await readFile(new URL('../public/fixtures/notes/note-17942.json', import.meta.url), 'utf8'))
  const saved = JSON.parse(walkToRead) as { note: Record<string, unknown> }
  assert.deepEqual(Object.keys(saved.note),
    ['id', 'place_id', 'author', 'created_at', 'walk_to_read', 'first_line', 'body_text_bytes', 'read_in_person'])
  assert.deepEqual(parseNoteExcerpt(saved, 17942),
    { id: 17942, author: 'buzz', placeId: 782, text: 'Field note, east wall', cut: false, readInPerson: true })
  const ordinary = parseNoteExcerpt({ note: { ...saved.note, body: 'opened in a retired place', first_line: undefined } }, 17942)
  assert.deepEqual(ordinary, { id: 17942, author: 'buzz', placeId: 782, text: 'opened in a retired place', cut: false })
  for (const note of [
    { ...saved.note, walk_to_read: undefined },
    { ...saved.note, first_line: undefined },
    { ...saved.note, first_line: 3 },
    { ...saved.note, read_in_person: undefined },
    { ...saved.note, read_in_person: ' ' },
    { ...saved.note, body: null },
  ]) assert.throws(() => parseNoteExcerpt({ note }, 17942), /note/)
})

test('single-note reads are anonymous and cached including missing or failed answers', async t => {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async (url, options) => {
    calls.push(String(url))
    assert.equal(options?.credentials, 'omit')
    return Response.json(note)
  }
  t.after(() => { globalThis.fetch = original })
  const load = createNoteExcerptLoader('')
  const pending = load(13243)
  assert.equal(pending, load(13243))
  await pending
  await load(13243)
  await createNoteExcerptLoader('?census=/fixtures/residents-presence-page1.json')(13243)
  await createNoteExcerptLoader('?notes=/saved/notes/')(13243)
  assert.deepEqual(calls, ['https://1f3d9.com/api/note/13243', 'fixtures/notes/note-13243.json', '/saved/notes/note-13243.json'])
  globalThis.fetch = async () => new Response('', { status: 404 })
  const missing = createNoteExcerptLoader('')
  assert.equal(await missing(1), null)
  assert.equal(await missing(1), null)
  globalThis.fetch = async () => new Response('<html>missing</html>', { headers: { 'content-type': 'text/html' } })
  assert.equal(await createNoteExcerptLoader('?census=/saved/census.json')(1), null)
  globalThis.fetch = async () => new Response('', { status: 503 })
  const failed = createNoteExcerptLoader('')
  await assert.rejects(failed(1), /503/)
  await assert.rejects(failed(1), /503/)
  await assert.rejects(load(0), /positive/)
})

test('a moderated note answer is parsed as removed without its text', () => {
  assert.deepEqual(parseNoteExcerpt({ note: { id: 1, author: 'vigil', place_id: 2, moderated: true } }, 1),
    { id: 1, author: 'vigil', placeId: 2, text: '', cut: false, removed: true })
})

test('room lines keep readable rows in id order and count removed and dropped rows', () => {
  const page = parseRoomLines({ lines: [
    { id: 4, place_id: 731, author: 'vigil', body: 'four', created_at: '2026-09-25T10:00:00Z' },
    { id: 2, place_id: 731, author: 'ada', body: 'two', created_at: '2026-09-25T09:00:00Z' },
    { id: 6, moderated: true },
    { id: 8, place_id: 732, author: 'ada', body: 'other room', created_at: '2026-09-25T11:00:00Z' },
    { id: 9, place_id: 731, author: 'Bad Handle', body: 'bad author', created_at: '2026-09-25T11:00:00Z' },
    { id: 10, place_id: 731, author: 'vigil', body: '', created_at: '2026-09-25T11:00:00Z' },
    { id: 11, place_id: 731, author: 'vigil', body: 'first\nsecond', created_at: '2026-09-25T11:00:00Z' },
    { id: 12, place_id: 731, author: 'vigil', body: 'bad date', created_at: 'not a date' },
  ] }, 731)

  assert.deepEqual(page, {
    lines: [
      { id: 2, placeId: 731, author: 'ada', body: 'two', createdAt: '2026-09-25T09:00:00Z' },
      { id: 4, placeId: 731, author: 'vigil', body: 'four', createdAt: '2026-09-25T10:00:00Z' },
    ],
    removedIds: [6],
    dropped: 5,
  })
  assert.equal(Object.isFrozen(page.lines), true)
  assert.equal(Object.isFrozen(page.removedIds), true)
  assert.equal(Object.isFrozen(page.lines[0]), true)
  assert.throws(() => parseRoomLines(null, 731), /incomplete/)
  assert.throws(() => parseRoomLines({}, 731), /incomplete/)
})

test('room line reads use the shared marker URL and the fixture override', async t => {
  const original = globalThis.fetch
  const calls: { url: string; options?: RequestInit }[] = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), ...(options ? { options } : {}) })
    return Response.json({ lines: [] })
  }
  t.after(() => { globalThis.fetch = original })

  await fetchRoomLines(731, '100299', '')
  await fetchRoomLines(731, '100299', '?roomlines=/fx')
  await fetchRoomLines(731, '100299', '?census=x')

  assert.deepEqual(calls.map(call => call.url), [
    'https://1f3d9.com/api/window?collection=lines&place_id=731&limit=50&after_change_marker=100299',
    '/fx/lines-731-100299.json',
    'fixtures/room-lines/lines-731-100299.json',
  ])
  assert.equal(calls[0]!.options?.credentials, 'omit')
  assert.deepEqual(calls[0]!.options?.headers, { accept: 'application/json' })
  assert.ok(calls[0]!.options?.signal instanceof AbortSignal)
})
