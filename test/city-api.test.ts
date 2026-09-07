import assert from 'node:assert/strict'
import test from 'node:test'
import { createDrawingLoader, fetchCensus, fetchReplay } from '../src/city/api.ts'

const resident = (id: number) => ({ id, handle: `resident-${id}`, model: '', joined_at: '2026-01-01T00:00:00Z', has_drawing: true, current_place_id: 1, asleep: false })

test('fetchCensus follows every live before_id page', async (t) => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    urls.push(String(input))
    return Response.json(urls.length === 1
      ? { residents: [resident(3), resident(2)], returned_items: 2, has_more: true, next_before_id: 2 }
      : { residents: [resident(1)], returned_items: 1, has_more: false, next_before_id: null })
  }
  t.after(() => { globalThis.fetch = original })

  assert.deepEqual((await fetchCensus('')).map(item => item.id), [3, 2, 1])
  assert.match(urls[1] ?? '', /before_id=2/)
})

test('public reads send only an anonymous JSON accept header', async (t) => {
  const original = globalThis.fetch
  let options: RequestInit | undefined
  globalThis.fetch = async (_input, init) => {
    options = init
    return Response.json({ residents: [], returned_items: 0, has_more: false, next_before_id: null })
  }
  t.after(() => { globalThis.fetch = original })
  await fetchCensus('')
  assert.deepEqual(options?.headers, { accept: 'application/json' })
  assert.ok(options?.signal instanceof AbortSignal)
})

test('fetchCensus advances named fixture pages without live calls', async (t) => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    urls.push(String(input))
    return Response.json(urls.length === 1
      ? { residents: [resident(2)], returned_items: 1, has_more: true, next_before_id: 2 }
      : { residents: [resident(1)], returned_items: 1, has_more: false, next_before_id: null })
  }
  t.after(() => { globalThis.fetch = original })

  await fetchCensus('?census=/fixtures/residents-presence-page1.json')
  assert.deepEqual(urls, ['/fixtures/residents-presence-page1.json', '/fixtures/residents-presence-page2.json'])
})

test('fetchCensus rejects dishonest pagination shapes', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({ residents: [], has_more: true })
  t.after(() => { globalThis.fetch = original })
  await assert.rejects(fetchCensus(''), /next_before_id/)
})

test('fetchCensus stops repeated pagination cursors', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({ residents: [], returned_items: 0, has_more: true, next_before_id: 7 })
  t.after(() => { globalThis.fetch = original })
  await assert.rejects(fetchCensus(''), /repeated next_before_id/)
})

test('fetchReplay reports missing required public fields', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({ window_start: '2026-01-01T00:00:00Z' })
  t.after(() => { globalThis.fetch = original })
  await assert.rejects(fetchReplay('/fixture.json'), /invalid replay file/)
})

test('drawing loader caches one promise per id, including 404 and failures', async (t) => {
  const original = globalThis.fetch
  const calls = new Map<string, number>()
  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.set(url, (calls.get(url) ?? 0) + 1)
    if (url.endsWith('2.json')) return new Response('', { status: 404 })
    if (url.endsWith('3.json')) return Response.json({ type: 'resident', id: 3, state: 'draft', drawing: null })
    if (url.endsWith('4.json')) throw new Error('offline')
    return Response.json({ type: 'resident', id: 1, state: 'complete', drawing: { palette: ['#ffffff'], indices: Array(64).fill(null) } })
  }
  t.after(() => { globalThis.fetch = original })
  const load = createDrawingLoader('?drawings=/fixtures/drawings')

  assert.equal(await load(1), await load(1))
  assert.equal(await load(2), null)
  assert.equal(await load(2), null)
  assert.equal(await load(3), null)
  await assert.rejects(load(4), /offline/)
  await assert.rejects(load(4), /offline/)
  assert.deepEqual([...calls.values()], [1, 1, 1, 1])
})

test('drawing loader rejects malformed complete drawing data', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({
    type: 'resident', id: 8, state: 'complete',
    drawing: { palette: ['not-a-color'], indices: Array(64).fill(0) },
  })
  t.after(() => { globalThis.fetch = original })
  await assert.rejects(createDrawingLoader('')(8), /invalid resident drawing 8/)
})
