import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createNoteExcerptLoader, fetchChanges, parseChangesPage, parseNoteExcerpt } from '../src/city/changes.ts'

const feed = JSON.parse(await readFile(new URL('./fixtures/changes-live.json', import.meta.url), 'utf8'))
const note = JSON.parse(await readFile(new URL('./fixtures/notes/note-13243.json', import.meta.url), 'utf8'))

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
  await fetchChanges('100123', '?replay=/saved/day.json')
  await fetchChanges('100123', '?census=/saved/census.json&changes=/saved/changes.json')
  assert.deepEqual(calls.map(call => call.url), [
    'https://1f3d9.com/api/changes?since=100123&limit=200', '/fixtures/changes-live.json', '/saved/changes.json',
  ])
  assert.equal(calls[0]!.options?.credentials, 'omit')
  assert.deepEqual(calls[0]!.options?.headers, { accept: 'application/json' })
  assert.ok(calls[0]!.options?.signal instanceof AbortSignal)
  await assert.rejects(fetchChanges('invalid', ''), /marker/)
  globalThis.fetch = async () => new Response('', { status: 503 })
  await assert.rejects(fetchChanges('0', ''), /503/)
  globalThis.fetch = async () => new Response('<html>missing</html>', { headers: { 'content-type': 'text/html' } })
  await assert.rejects(fetchChanges('0', '?replay=/saved/day.json'))
})

test('a real single-note read yields its own author, room and short first line', () => {
  const excerpt = parseNoteExcerpt(note, 13243)
  assert.deepEqual(excerpt, { id: 13243, author: 'buzz', placeId: 782, text: 'GUESS ROUND 002: thog', cut: true })
  const short = { note: { id: 1, author: 'one', place_id: 3, body: 'hello' } }
  assert.equal(parseNoteExcerpt(short, 1).cut, false)
  assert.equal(parseNoteExcerpt({ note: { ...short.note, body: 'x'.repeat(250) } }, 1).text.length, 200)
  for (const value of [null, {}, { note: { ...short.note, id: 2 } }, { note: { ...short.note, place_id: null } },
    { note: { ...short.note, body: 3 } }, { note: { ...short.note, author: null } }]) {
    assert.throws(() => parseNoteExcerpt(value, 1), /note/)
  }
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
  await createNoteExcerptLoader('?replay=/saved/day.json')(13243)
  await createNoteExcerptLoader('?notes=/saved/notes/')(13243)
  assert.deepEqual(calls, ['https://1f3d9.com/api/note/13243', '/fixtures/notes/note-13243.json', '/saved/notes/note-13243.json'])
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
