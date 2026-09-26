import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchTalkNow, parseTalkNow } from '../src/city/talk-now.ts'

test('parses the talk head, served interval, and only good listening rows', () => {
  const head = parseTalkNow({ line_marker: '100299', check_interval_ms: 4_000, listening: [
    { place_id: 731, resident_id: 302, handle: 'buzz', listening_until: '2026-09-07T13:54:35.000Z' },
    { place_id: 0, resident_id: 303, handle: 'invalid-place', listening_until: '2026-09-07T13:54:35.000Z' },
    { place_id: 731, resident_id: 0, handle: 'invalid-id', listening_until: '2026-09-07T13:54:35.000Z' },
    { place_id: 731, resident_id: 304, handle: 'Bad Handle', listening_until: '2026-09-07T13:54:35.000Z' },
    { place_id: 731, resident_id: 305, handle: 'valid', listening_until: 'not a date' },
    null,
  ] })

  assert.deepEqual(head, { lineMarker: '100299', checkMs: 4_000, listening: [
    { placeId: 731, residentId: 302, handle: 'buzz', listeningUntil: '2026-09-07T13:54:35.000Z' },
  ] })
})

test('uses the talk interval floor and fallback while parsing', () => {
  assert.equal(parseTalkNow({ line_marker: '0', check_interval_ms: 500, listening: [] }).checkMs, 2_000)
  assert.equal(parseTalkNow({ line_marker: '8', check_interval_ms: 6_000, listening: [] }).checkMs, 6_000)
  assert.equal(parseTalkNow({ line_marker: '9', listening: [] }).checkMs, 2_000)
})

test('rejects an incomplete marker or listening list', () => {
  assert.throws(() => parseTalkNow({ line_marker: '01', listening: [] }), /The talk check answer is incomplete\./)
  assert.throws(() => parseTalkNow({ line_marker: '100299' }), /The talk check answer is incomplete\./)
})

test('reads the shared live head without a marker query and honors a fixture path', async t => {
  const original = globalThis.fetch
  const calls: { url: string; options?: RequestInit }[] = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), ...(options ? { options } : {}) })
    return Response.json({ line_marker: '0', check_interval_ms: 2_000, listening: [] })
  }
  t.after(() => { globalThis.fetch = original })

  await fetchTalkNow('')
  await fetchTalkNow('?talk=/fx/t.json')

  assert.deepEqual(calls.map(call => call.url), ['https://1f3d9.com/api/talk/now', '/fx/t.json'])
  assert.equal(calls[0]!.options?.method, 'GET')
  assert.equal(calls[0]!.options?.credentials, 'omit')
  assert.deepEqual(calls[0]!.options?.headers, { accept: 'application/json' })
  assert.ok(calls[0]!.options?.signal instanceof AbortSignal)
})
