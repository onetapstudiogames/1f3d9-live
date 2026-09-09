import assert from 'node:assert/strict'
import test from 'node:test'
import { createDrawingLoader, fetchPlaceOutline, createThingLoader, fetchCensus, fetchDrawing, fetchThing } from '../src/city/api.ts'

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
  assert.equal(options?.credentials, 'omit')
  assert.ok(options?.signal instanceof AbortSignal)
})

test('place outline loader reads fresh direct things and preserves drawing flags when present', async (t) => {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async (input, options) => {
    calls.push(String(input))
    assert.equal(options?.credentials, 'omit')
    assert.equal((options?.headers as Record<string, string>)['authorization'], undefined)
    return Response.json({ place: { id: 3, name: ' the square ', parent_id: 2, owner: 'founder', owner_id: 1, quiet: false }, things: [
      { id: 9, name: ' parcel ', place_id: 3 },
      { id: 8, name: 'painted', place_id: 3, has_drawing: true },
      { id: 6, name: 'plain', place_id: 3, has_drawing: false },
      { id: 7, name: 'wrong room', place_id: 4, has_drawing: true },
    ], things_page: { total_items: 3, returned_items: 4, has_more: false, next_before_thing_id: null } })
  }
  t.after(() => { globalThis.fetch = original })
  const load = (id: number) => fetchPlaceOutline(id, '?places=/fixtures/places')
  const [first, second] = await Promise.all([load(3), load(3)])
  assert.notEqual(first, second)
  assert.deepEqual(first, { placeId: 3, name: 'the square', parentId: 2, owner: 'founder', ownerId: 1, quiet: false, things: [
    { id: 9, name: 'parcel', placeId: 3, hasDrawing: undefined },
    { id: 8, name: 'painted', placeId: 3, hasDrawing: true },
    { id: 6, name: 'plain', placeId: 3, hasDrawing: false },
  ], totalItems: 3, hasMore: false, lawNames: null })
  assert.deepEqual(calls, ['/fixtures/places/place-3.json', '/fixtures/places/place-3.json'])
})

test('place outline loader follows bounded thing pages for the same room', async (t) => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async input => {
    const url = String(input)
    urls.push(url)
    const cursor = new URL(url).searchParams.get('before_thing_id')
    const ids = cursor === null ? [23, 22, 21, 20, 19, 18, 17, 16, 15, 14]
      : cursor === '14' ? [13, 12, 11, 10, 9, 8, 7, 6, 5, 4] : [3, 2, 1]
    return Response.json({
      place: { id: 498, name: 'still room', parent_id: 2, owner: null, owner_id: null, quiet: false },
      things: ids.map(id => ({ id, name: `thing ${String(id)}`, place_id: 498 })),
      things_page: { total_items: 23, returned_items: ids.length, has_more: ids[ids.length - 1] !== 1,
        ...(cursor === null
          ? { next: '/api/place/498?view=outline&before_thing_id=14' }
          : { next_before_thing_id: ids[ids.length - 1] === 1 ? null : ids[ids.length - 1] }) },
    })
  }
  t.after(() => { globalThis.fetch = original })

  const outline = await fetchPlaceOutline(498, '')
  assert.equal(outline?.things.length, 23)
  assert.equal(outline?.hasMore, false)
  assert.ok(outline?.things.every(thing => thing.hasDrawing === undefined))
  assert.deepEqual(urls, [
    'https://1f3d9.com/api/place/498?view=outline',
    'https://1f3d9.com/api/place/498?view=outline&before_thing_id=14',
    'https://1f3d9.com/api/place/498?view=outline&before_thing_id=4',
  ])
})

test('place outline fixture pagination stays inside its named fixture root', async (t) => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async input => {
    const url = String(input)
    urls.push(url)
    const first = url.endsWith('place-7.json')
    return Response.json({
      place: { id: 7, name: 'room', parent_id: 2, owner: null, owner_id: null, quiet: false },
      things: [{ id: first ? 9 : 8, name: 'thing', place_id: 7 }],
      things_page: { total_items: 2, returned_items: 1, has_more: first,
        next_before_thing_id: first ? 9 : null },
    })
  }
  t.after(() => { globalThis.fetch = original })

  assert.equal((await fetchPlaceOutline(7, '?places=/saved/places'))?.things.length, 2)
  assert.deepEqual(urls, ['/saved/places/place-7.json', '/saved/places/place-7-before-9.json'])
})

test('a missing saved continuation keeps its partial fixture while a missing live continuation fails', async t => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return calls % 2 === 0 ? new Response('', { status: 404 }) : Response.json({
      place: { id: 7, name: 'room', parent_id: 2, owner: null, owner_id: null, quiet: false },
      things: [{ id: 9, name: 'parcel', place_id: 7 }],
      things_page: { total_items: 2, has_more: true, next_before_thing_id: 9 },
    })
  }
  t.after(() => { globalThis.fetch = original })
  const fixture = await fetchPlaceOutline(7, '?places=/saved/places')
  assert.deepEqual(fixture?.things.map(thing => thing.id), [9])
  assert.equal(fixture?.hasMore, true)
  assert.equal(calls, 2)
  await assert.rejects(fetchPlaceOutline(7, ''), /404.*page 2/)
  assert.equal(calls, 4)
})

test('place outline pagination rejects missing and repeated cursors', async (t) => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return Response.json({
      place: { id: 7, name: 'room', parent_id: 2, owner: null, owner_id: null, quiet: false }, things: [],
      things_page: { total_items: 2, returned_items: 0, has_more: true,
        ...(calls === 1 ? { next_before_thing_id: 9 } : { next_before_thing_id: 9 }) },
    })
  }
  t.after(() => { globalThis.fetch = original })
  await assert.rejects(fetchPlaceOutline(7, ''), /repeated next_before_thing_id 9/)

  globalThis.fetch = async () => Response.json({
    place: { id: 7, name: 'room', parent_id: 2, owner: null, owner_id: null, quiet: false }, things: [],
    things_page: { total_items: 2, returned_items: 0, has_more: true,
      next: 'https://evil.example/api/place/7?view=outline&before_thing_id=6' },
  })
  await assert.rejects(fetchPlaceOutline(7, ''), /next_before_thing_id/)
})

test('place outline pagination reads at most 200 pages and returns at most 200 unique things', async (t) => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    const id = 1000 - calls
    return Response.json({
      place: { id: 7, name: 'room', parent_id: 2, owner: null, owner_id: null, quiet: false },
      things: [{ id, name: `thing ${String(id)}`, place_id: 7 }],
      things_page: { total_items: 500, returned_items: 1, has_more: true, next_before_thing_id: id },
    })
  }
  t.after(() => { globalThis.fetch = original })

  const outline = await fetchPlaceOutline(7, '')
  assert.equal(calls, 200)
  assert.equal(outline?.things.length, 200)
  assert.equal(outline?.hasMore, true)
})

test('place outline reports local truncation when one complete page contains over 200 things', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({
    place: { id: 7, name: 'room', parent_id: 2, owner: null, owner_id: null, quiet: false },
    things: Array.from({ length: 201 }, (_, index) => ({ id: index + 1, name: `thing ${String(index + 1)}`, place_id: 7 })),
    things_page: { total_items: 201, returned_items: 201, has_more: false, next_before_thing_id: null },
  })
  t.after(() => { globalThis.fetch = original })

  const outline = await fetchPlaceOutline(7, '')
  assert.equal(outline?.things.length, 200)
  assert.equal(outline?.hasMore, true)
})

test('place outline stops after 200 pages even when pages add no unique things', async (t) => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return Response.json({
      place: { id: 7, name: 'room', parent_id: 2, owner: null, owner_id: null, quiet: false }, things: [],
      things_page: { total_items: 500, returned_items: 0, has_more: true, next_before_thing_id: 1000 - calls },
    })
  }
  t.after(() => { globalThis.fetch = original })

  const outline = await fetchPlaceOutline(7, '')
  assert.equal(calls, 200)
  assert.equal(outline?.things.length, 0)
  assert.equal(outline?.hasMore, true)
})

test('a later quiet outline page clears accumulated things and stops reading', async (t) => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    const quiet = calls === 2
    return Response.json({
      place: { id: 7, name: quiet ? 'private room' : 'room', parent_id: 2, owner: null, owner_id: null, quiet },
      things: [{ id: calls, name: 'private thing', place_id: 7 }],
      things_page: { total_items: 2, returned_items: 1, has_more: !quiet, next_before_thing_id: quiet ? null : 9 },
    })
  }
  t.after(() => { globalThis.fetch = original })

  const outline = await fetchPlaceOutline(7, '')
  assert.equal(calls, 2)
  assert.equal(outline?.quiet, true)
  assert.equal(outline?.name, 'private room')
  assert.deepEqual(outline?.things, [])
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

test('an empty census switch stays on the relative saved census', async (t) => {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = async input => {
    urls.push(String(input))
    return Response.json({ residents: [], returned_items: 0, has_more: false, next_before_id: null })
  }
  t.after(() => { globalThis.fetch = original })

  await fetchCensus('?census')
  assert.deepEqual(urls, ['fixtures/residents-presence-page1.json'])
})

test('fetchCensus preserves optional looking presence for the live viewer', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({ residents: [{
    ...resident(1),
    looking: { place_id: 1, started_at: '2026-09-07T12:00:00Z', expires_at: '2026-09-07T12:01:00Z' },
  }], returned_items: 1, has_more: false, next_before_id: null })
  t.after(() => { globalThis.fetch = original })
  assert.deepEqual((await fetchCensus(''))[0]?.looking, {
    place_id: 1, started_at: '2026-09-07T12:00:00Z', expires_at: '2026-09-07T12:01:00Z',
  })
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

test('drawing loader caches success and absence but retries after a transient failure', async (t) => {
  const original = globalThis.fetch
  const calls = new Map<string, number>()
  globalThis.fetch = async (input) => {
    const url = String(input)
    calls.set(url, (calls.get(url) ?? 0) + 1)
    if (url.endsWith('2.json')) return new Response('', { status: 404 })
    if (url.endsWith('3.json')) return Response.json({ type: 'resident', id: 3, state: 'draft', drawing: null })
    if (url.endsWith('4.json') && calls.get(url) === 1) throw new Error('offline')
    if (url.endsWith('4.json')) return Response.json({ type: 'resident', id: 4, state: 'complete',
      drawing: { palette: ['#ffffff'], indices: Array(64).fill(0) } })
    return Response.json({ type: 'resident', id: 1, state: 'complete', drawing: { palette: ['#ffffff'], indices: Array(64).fill(null) } })
  }
  t.after(() => { globalThis.fetch = original })
  const load = createDrawingLoader('?drawings=/fixtures/drawings')

  assert.equal(await load(1), await load(1))
  assert.equal(await load(2), null)
  assert.equal(await load(2), null)
  assert.equal(await load(3), null)
  await assert.rejects(load(4), /offline/)
  assert.equal((await load(4))?.id, 4)
  assert.equal((await load(4))?.id, 4)
  assert.deepEqual([...calls.values()], [1, 1, 1, 2])
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

test('place drawing loader uses the place path, caches results, and retries errors', async (t) => {
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
  assert.deepEqual([...calls.values()], [1, 1, 1, 2])
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

test('a place drawing server error stays in plain words and can be retried', async (t) => {
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
  assert.deepEqual(urls, [
    'https://1f3d9.com/api/drawing/place/1',
    'https://1f3d9.com/api/drawing/place/1',
  ])
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

  assert.deepEqual(await fetchThing(7, '?census=/fixtures/residents-presence-page1.json'), { id: 7, name: 'small lantern', has_drawing: true })
  assert.equal((await fetchDrawing('thing', 7, '?drawings=/fixtures/drawings'))?.type, 'thing')
  // A record override on its own leaves every drawing with the live city.
  assert.equal((await fetchDrawing('resident', 7, '?census=/fixtures/residents-presence-page1.json'))?.id, 7)
  assert.equal((await fetchDrawing('place', 7, '?census=/fixtures/residents-presence-page1.json'))?.id, 7)
  assert.deepEqual(urls, [
    'fixtures/things/thing-7.json',
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
  assert.equal(await fetchThing(8, '?census=/fixtures/residents-presence-page1.json'), null)
  assert.deepEqual(urls, ['fixtures/things/thing-8.json'])
})
