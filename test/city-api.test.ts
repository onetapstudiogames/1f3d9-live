import assert from 'node:assert/strict'
import test from 'node:test'
import { createDrawingLoader, createNameHistoryLoader, createThingLoader, fetchCensus, fetchDrawing, fetchReplay, fetchThing } from '../src/city/api.ts'

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

test('a drawing with indices but no palette is refused in plain words', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({
    type: 'resident', id: 5, state: 'complete',
    drawing: { indices: Array(64).fill(0) },
  })
  t.after(() => { globalThis.fetch = original })
  await assert.rejects(createDrawingLoader('')(5), /invalid resident drawing 5/)
})

test('place drawing loader uses the place path and caches success, absence, and errors', async (t) => {
  const original = globalThis.fetch
  const calls = new Map<string, number>()
  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.set(url, (calls.get(url) ?? 0) + 1)
    if (url.endsWith('place-2.json')) return new Response('', { status: 404 })
    if (url.endsWith('place-3.json')) return Response.json({ type: 'place', id: 3, state: 'draft', drawing: null })
    if (url.endsWith('place-4.json')) throw new Error('fixture unreadable')
    return Response.json({ type: 'place', id: 1, state: 'complete', drawing: { palette: ['#123026'], indices: Array(64).fill(0) } })
  }
  t.after(() => { globalThis.fetch = original })
  const load = createDrawingLoader('?drawings=/fixtures/drawings', 'place')

  assert.equal((await load(1))?.type, 'place')
  assert.equal((await load(1))?.id, 1)
  assert.equal(await load(2), null)
  assert.equal(await load(2), null)
  assert.equal(await load(3), null)
  await assert.rejects(load(4), /fixture unreadable/)
  await assert.rejects(load(4), /fixture unreadable/)
  assert.deepEqual([...calls.keys()], [
    '/fixtures/drawings/place-1.json',
    '/fixtures/drawings/place-2.json',
    '/fixtures/drawings/place-3.json',
    '/fixtures/drawings/place-4.json',
  ])
  assert.deepEqual([...calls.values()], [1, 1, 1, 1])
})

test('place drawings reject malformed shapes and mismatched identity', async (t) => {
  const original = globalThis.fetch
  const responses = [
    { type: 'resident', id: 7, state: 'complete', drawing: { palette: ['#ffffff'], indices: Array(64).fill(0) } },
    { type: 'place', id: 8, state: 'complete', drawing: { palette: ['#ffffff'], indices: Array(63).fill(0) } },
  ]
  globalThis.fetch = async () => Response.json(responses.shift())
  t.after(() => { globalThis.fetch = original })

  await assert.rejects(createDrawingLoader('', 'place')(7), /invalid place drawing 7/)
  await assert.rejects(createDrawingLoader('', 'place')(7), /invalid place drawing 7/)
})

test('drawing requests validate type and id before reading the city', async (t) => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return new Response('', { status: 404 }) }
  t.after(() => { globalThis.fetch = original })

  await assert.rejects(fetchDrawing('resident', 0), /invalid drawing request/)
  await assert.rejects(fetchDrawing('place', 1.5), /invalid drawing request/)
  await assert.rejects(fetchDrawing('other' as 'place', 1), /invalid drawing request/)
  assert.equal(calls, 0)
})

test('missing fixture HTML means no saved drawing and never falls back to the live city', async (t) => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    urls.push(String(input))
    return new Response('<!doctype html><title>Vite fallback</title>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
  t.after(() => { globalThis.fetch = original })

  assert.equal(await createDrawingLoader('?drawings=/fixtures/drawings', 'place')(99), null)
  assert.deepEqual(urls, ['/fixtures/drawings/place-99.json'])
})

test('fixture JSON parse and read failures stay visible', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('{broken', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  t.after(() => { globalThis.fetch = original })
  await assert.rejects(createDrawingLoader('?drawings=/fixtures/drawings', 'place')(1), /JSON/)
})

test('a place drawing server error stays in plain words and is not fetched again', async (t) => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async input => {
    urls.push(String(input))
    return new Response('', { status: 503 })
  }
  t.after(() => { globalThis.fetch = original })
  const load = createDrawingLoader('', 'place')
  await assert.rejects(load(1), /the city answered 503 for the place drawing 1/)
  await assert.rejects(load(1), /the city answered 503 for the place drawing 1/)
  assert.deepEqual(urls, ['https://1f3d9.com/api/drawing/place/1'])
})

test('a record override saves thing labels, and only ?drawings= saves art', async (t) => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async input => {
    const url = String(input)
    urls.push(url)
    if (url.includes('/things/')) return Response.json({ thing: { id: 7, name: 'small lantern', place_id: 999, has_drawing: true } })
    const type = /(resident|place|thing)/.exec(url)?.[1]
    return Response.json({ type, id: 7, state: 'complete', drawing: { palette: ['#ffffff'], indices: Array(64).fill(0) } })
  }
  t.after(() => { globalThis.fetch = original })

  assert.deepEqual(await fetchThing(7, '?replay=/fixtures/replay-24h.json'), { id: 7, name: 'small lantern', has_drawing: true })
  assert.equal((await fetchDrawing('thing', 7, '?drawings=/fixtures/drawings'))?.type, 'thing')
  // A record override on its own leaves every drawing with the live city.
  assert.equal((await fetchDrawing('resident', 7, '?replay=/fixtures/replay-24h.json'))?.id, 7)
  assert.equal((await fetchDrawing('place', 7, '?census=/fixtures/residents-presence-page1.json'))?.id, 7)
  assert.deepEqual(urls, [
    '/fixtures/things/thing-7.json',
    '/fixtures/drawings/thing-7.json',
    'https://1f3d9.com/api/drawing/resident/7',
    'https://1f3d9.com/api/drawing/place/7',
  ])
})

test('thing loader caches success, absence, and failures and supports an override root', async (t) => {
  const original = globalThis.fetch
  const calls = new Map<string, number>()
  globalThis.fetch = async input => {
    const url = String(input)
    calls.set(url, (calls.get(url) ?? 0) + 1)
    if (url.endsWith('thing-2.json')) return new Response('', { status: 404 })
    if (url.endsWith('thing-3.json')) throw new Error('offline')
    return Response.json({ thing: { id: 1, name: 'cup', place_id: 55, has_drawing: false } })
  }
  t.after(() => { globalThis.fetch = original })
  const load = createThingLoader('?things=/saved/things')

  assert.deepEqual(await load(1), { id: 1, name: 'cup', has_drawing: false })
  assert.equal(await load(2), null)
  assert.equal(await load(2), null)
  await assert.rejects(load(3), /offline/)
  await assert.rejects(load(3), /offline/)
  assert.deepEqual([...calls.values()], [1, 1, 1])
})

test('thing reads validate request and response identity, name, and has_drawing', async (t) => {
  const original = globalThis.fetch
  const bodies = [{ thing: { id: 4, name: 'wrong', has_drawing: false } }, { thing: { id: 5, name: 'no flag' } }]
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return Response.json(bodies.shift()) }
  t.after(() => { globalThis.fetch = original })

  await assert.rejects(fetchThing(0, ''), /invalid thing request/)
  await assert.rejects(fetchThing(Number.MAX_SAFE_INTEGER + 1, ''), /invalid thing request/)
  assert.equal(calls, 0)
  await assert.rejects(fetchThing(3, ''), /invalid thing 3/)
  // Without a stated has_drawing the answer is refused rather than guessed at.
  await assert.rejects(fetchThing(5, ''), /invalid thing 5/)
})

test('missing fixture HTML means no saved thing and never falls back live', async (t) => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async input => {
    urls.push(String(input))
    return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
  }
  t.after(() => { globalThis.fetch = original })
  assert.equal(await fetchThing(8, '?replay=/fixtures/replay.json'), null)
  assert.deepEqual(urls, ['/fixtures/things/thing-8.json'])
})

test('name history loader reads one anonymous live outline and caches it', async (t) => {
  const original = globalThis.fetch
  const calls: Array<{ url: string, init?: RequestInit }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    return Response.json({ place: { id: 264, name_history: [
      { name: 'old room', started_at: '2026-01-01T00:00:00Z', ended_at: '2026-02-01T00:00:00Z' },
      { name: 'new room', started_at: '2026-02-01T00:00:00Z', ended_at: null },
    ] } })
  }
  t.after(() => { globalThis.fetch = original })

  const load = createNameHistoryLoader('')
  assert.equal((await load(264))?.[0]?.name, 'old room')
  assert.equal((await load(264))?.[1]?.name, 'new room')
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, 'https://1f3d9.com/api/map?view=outline&parent_id=264&limit=1')
  assert.deepEqual(calls[0]?.init?.headers, { accept: 'application/json' })
  assert.ok(calls[0]?.init?.signal instanceof AbortSignal)
})

test('name history fixtures use their default or named root without a live fallback', async (t) => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async input => {
    urls.push(String(input))
    return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
  }
  t.after(() => { globalThis.fetch = original })

  assert.equal(await createNameHistoryLoader('?replay=/fixtures/replay.json')(9), null)
  assert.equal(await createNameHistoryLoader('?census=/fixtures/census.json&places=/saved/outlines')(10), null)
  assert.deepEqual(urls, ['/fixtures/places/place-9.json', '/saved/outlines/place-10.json'])
})

test('name history loader caches missing places and failed promises', async (t) => {
  const original = globalThis.fetch
  const calls = new Map<string, number>()
  globalThis.fetch = async input => {
    const url = String(input)
    calls.set(url, (calls.get(url) ?? 0) + 1)
    if (url.includes('parent_id=1')) return new Response('', { status: 404 })
    throw new Error('outline offline')
  }
  t.after(() => { globalThis.fetch = original })
  const load = createNameHistoryLoader('')

  assert.equal(await load(1), null)
  assert.equal(await load(1), null)
  await assert.rejects(load(2), /outline offline/)
  await assert.rejects(load(2), /outline offline/)
  assert.deepEqual([...calls.values()], [1, 1])
})

test('name history loader validates requests, envelope identity, and history', async (t) => {
  const original = globalThis.fetch
  const bodies = [
    { place: { id: 8, name_history: [] } },
    { place: { id: 7 } },
    { place: { id: 7, name_history: [{ name: '', started_at: 'bad', ended_at: null }] } },
  ]
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return Response.json(bodies.shift()) }
  t.after(() => { globalThis.fetch = original })

  await assert.rejects(createNameHistoryLoader('')(0), /invalid place history request/)
  assert.equal(calls, 0)
  await assert.rejects(createNameHistoryLoader('')(7), /invalid name history for place 7/)
  await assert.rejects(createNameHistoryLoader('')(7), /invalid name history for place 7/)
  await assert.rejects(createNameHistoryLoader('')(7), /invalid name history for place 7/)
})

test('name history server errors stay in plain words', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('', { status: 503 })
  t.after(() => { globalThis.fetch = original })
  await assert.rejects(createNameHistoryLoader('')(264), /the city answered 503 for place history 264/)
})
