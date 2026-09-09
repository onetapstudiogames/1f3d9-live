import type { CensusPage, Drawing, PlaceOutline, Resident, Thing } from './types.ts'
import { parseLawNames } from '../laws.ts'
import { MAX_ROOM_THINGS } from '../thing-limits.ts'

export const CITY_ORIGIN = 'https://1f3d9.com'
const READ_TIMEOUT_MS = 15_000
const MAX_OUTLINE_PAGES = 200

function readOptions(): RequestInit {
  return { credentials: 'omit', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(READ_TIMEOUT_MS) }
}

function searchValue(search: string, name: string): string | null {
  return new URLSearchParams(search).get(name)
}

function browserSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search
}

function fixtureMode(search: string): boolean {
  const params = new URLSearchParams(search)
  return params.has('census')
}

function requireResident(value: unknown, page: number): Resident {
  if (!value || typeof value !== 'object') throw new Error(`the census page ${page} contains an invalid resident`)
  const item = value as Record<string, unknown>
  if (!Number.isInteger(item['id']) || (typeof item['handle'] !== 'string' && item['handle'] !== null)
    || typeof item['model'] !== 'string' || typeof item['joined_at'] !== 'string'
    || typeof item['has_drawing'] !== 'boolean' || (typeof item['current_place_id'] !== 'number' && item['current_place_id'] !== null)
    || typeof item['asleep'] !== 'boolean') {
    throw new Error(`the census page ${page} contains an invalid resident`)
  }
  return value as Resident
}

function requireCensusPage(value: unknown, pageNumber: number): CensusPage {
  if (!value || typeof value !== 'object') throw new Error(`the census page ${pageNumber} is not an object`)
  const page = value as Record<string, unknown>
  if (!Array.isArray(page['residents']) || typeof page['has_more'] !== 'boolean') {
    throw new Error(`the census page ${pageNumber} is missing required fields`)
  }
  if (page['has_more'] && !Number.isInteger(page['next_before_id'])) {
    throw new Error(`the census page ${pageNumber} says it has more residents but has no next_before_id`)
  }
  const residents = page['residents'].map(item => requireResident(item, pageNumber))
  return {
    residents,
    returned_items: typeof page['returned_items'] === 'number' ? page['returned_items'] : residents.length,
    has_more: page['has_more'],
    next_before_id: typeof page['next_before_id'] === 'number' ? page['next_before_id'] : null,
  }
}

function nextFixturePage(url: string, pageNumber: number): string {
  const replaced = url.replace(/-page\d+(?=\.json(?:[?#]|$))/, `-page${pageNumber}`)
  if (replaced === url) throw new Error('the census fixture path must end in -page1.json')
  return replaced
}

export async function fetchCensus(search: string = browserSearch()): Promise<readonly Resident[]> {
  const fixture = searchValue(search, 'census')
    || (fixtureMode(search) ? 'fixtures/residents-presence-page1.json' : null)
  let url = fixture || `${CITY_ORIGIN}/api/residents?view=presence&limit=200`
  const residents: Resident[] = []
  const cursors = new Set<number>()
  for (let pageNumber = 1; ; pageNumber += 1) {
    if (pageNumber > 1000) throw new Error('the census exceeded the safe pagination limit')
    const response = await fetch(url, readOptions())
    if (!response.ok) throw new Error(`the city answered ${response.status} for census page ${pageNumber}`)
    const page = requireCensusPage(await response.json(), pageNumber)
    residents.push(...page.residents)
    if (!page.has_more) return residents
    const cursor = page.next_before_id as number
    if (cursors.has(cursor)) throw new Error(`census page ${pageNumber} repeated next_before_id ${cursor}`)
    cursors.add(cursor)
    if (fixture) url = nextFixturePage(fixture, pageNumber + 1)
    else {
      const next = new URL(url)
      next.searchParams.set('before_id', String(page.next_before_id))
      url = next.toString()
    }
  }
}

// Only ?drawings= sends art to saved files. A census override alone leaves drawings
// with the live city. Browser checks explicitly select their saved drawing root.
function drawingUrl(type: Drawing['type'], id: number, search: string): string {
  const root = searchValue(search, 'drawings')
  return root
    ? `${root.replace(/\/$/, '')}/${type}-${id}.json`
    : `${CITY_ORIGIN}/api/drawing/${type}/${id}`
}

export async function fetchDrawing(type: Drawing['type'], id: number, search: string = browserSearch()): Promise<Drawing | null> {
  if ((type !== 'resident' && type !== 'place' && type !== 'thing') || !Number.isSafeInteger(id) || id < 1) {
    throw new Error('invalid drawing request: expected a resident, place, or thing and a positive safe integer id')
  }
  const response = await fetch(drawingUrl(type, id, search), readOptions())
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`the city answered ${response.status} for the ${type} drawing ${id}`)
  const usesFixture = Boolean(searchValue(search, 'drawings'))
  if (usesFixture && response.headers.get('content-type')?.toLowerCase().includes('text/html')) return null
  const value = await response.json() as Partial<Drawing>
  if (value.state !== 'complete' || !value.drawing) return null
  const palette = value.drawing.palette
  // Read the palette first: without it the indices cannot be checked, and the reason must stay in plain words.
  if (!Array.isArray(palette) || !palette.every(color => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color))) {
    throw new Error(`the city returned an invalid ${type} drawing ${id}`)
  }
  const indices = value.drawing.indices
  const validIndices = Array.isArray(indices) && indices.length === 64
    && indices.every(index => index === null || (Number.isInteger(index) && index >= 0 && index < palette.length))
  if (value.type !== type || value.id !== id || !validIndices) {
    throw new Error(`the city returned an invalid ${type} drawing ${id}`)
  }
  return value as Drawing
}

export function createDrawingLoader(
  search: string = browserSearch(),
  type: Drawing['type'] = 'resident',
): (id: number) => Promise<Drawing | null> {
  const cache = new Map<number, Promise<Drawing | null>>()
  return (id: number) => {
    const cached = cache.get(id)
    if (cached) return cached
    const pending = fetchDrawing(type, id, search).catch(error => {
      if (cache.get(id) === pending) cache.delete(id)
      throw error
    })
    cache.set(id, pending)
    return pending
  }
}

function thingUrl(id: number, search: string): string {
  const fixtureRoot = searchValue(search, 'things')
  const root = fixtureRoot || (fixtureMode(search) ? 'fixtures/things' : null)
  return root ? `${root.replace(/\/$/, '')}/thing-${id}.json` : `${CITY_ORIGIN}/api/thing/${id}`
}

export async function fetchThing(id: number, search: string = browserSearch()): Promise<Thing | null> {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('invalid thing request: expected a positive safe integer id')
  const usesFixture = Boolean(searchValue(search, 'things')) || fixtureMode(search)
  const response = await fetch(thingUrl(id, search), readOptions())
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`the city answered ${response.status} for thing ${id}`)
  if (usesFixture && response.headers.get('content-type')?.toLowerCase().includes('text/html')) return null
  const value = await response.json() as unknown
  const envelope = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const thing = envelope?.['thing']
  if (!thing || typeof thing !== 'object') throw new Error(`the city returned an invalid thing ${id}`)
  const record = thing as Record<string, unknown>
  if (record['id'] !== id || typeof record['name'] !== 'string' || record['name'].trim().length === 0
    || typeof record['has_drawing'] !== 'boolean') {
    throw new Error(`the city returned an invalid thing ${id}`)
  }
  return { id, name: record['name'], has_drawing: record['has_drawing'] }
}

export function createThingLoader(search: string = browserSearch()): (id: number) => Promise<Thing | null> {
  const cache = new Map<number, Promise<Thing | null>>()
  return id => {
    const cached = cache.get(id)
    if (cached) return cached
    const pending = fetchThing(id, search)
    cache.set(id, pending)
    return pending
  }
}

export async function fetchPlaceOutline(id: number, search: string = browserSearch()): Promise<PlaceOutline | null> {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('invalid place outline request: expected a positive safe integer id')
  const root = searchValue(search, 'places') || (fixtureMode(search) ? 'fixtures/places' : null)
  const fixture = Boolean(root)
  const base = root ? `${root.replace(/\/$/, '')}/place-${id}` : `${CITY_ORIGIN}/api/place/${id}`
  let url = fixture ? `${base}.json` : `${base}?view=outline`
  const cursors = new Set<number>()
  const things = new Map<number, PlaceOutline['things'][number]>()
  let metadata: Omit<PlaceOutline, 'things' | 'hasMore'> | null = null
  let hasMore = false
  let locallyTruncated = false
  for (let pageNumber = 1; pageNumber <= MAX_OUTLINE_PAGES; pageNumber += 1) {
    const response = await fetch(url, readOptions())
    if (response.status === 404 && pageNumber === 1) return null
    // Saved outlines may stop at their first page; never fill that gap from the live city.
    if (fixture && response.status === 404) { hasMore = true; break }
    if (!response.ok) throw new Error(`the city answered ${response.status} for place outline ${id} page ${pageNumber}`)
    if (fixture && response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
      if (pageNumber === 1) return null
      hasMore = true
      break
    }
    const value = await response.json() as unknown
    const envelope = value && typeof value === 'object' ? value as Record<string, unknown> : null
    const place = envelope?.['place'] as Record<string, unknown> | undefined
    const page = envelope?.['things_page'] as Record<string, unknown> | undefined
    if (place?.['id'] !== id || typeof place['name'] !== 'string' || !(place['name'] as string).trim()
      || (place['parent_id'] !== null && (!Number.isSafeInteger(place['parent_id']) || (place['parent_id'] as number) < 1))
      || (place['owner'] !== null && typeof place['owner'] !== 'string')
      || (place['owner_id'] !== null && (!Number.isSafeInteger(place['owner_id']) || (place['owner_id'] as number) < 1))
      || typeof place['quiet'] !== 'boolean' || !Array.isArray(envelope?.['things']) || !page
      || !Number.isSafeInteger(page['total_items']) || (page['total_items'] as number) < 0 || typeof page['has_more'] !== 'boolean') {
      throw new Error(`the city returned an invalid place outline ${id} page ${pageNumber}`)
    }
    metadata = Object.freeze({ placeId: id, name: (place['name'] as string).trim(), parentId: place['parent_id'] as number | null,
      owner: place['owner'] as string | null, ownerId: place['owner_id'] as number | null,
      quiet: place['quiet'] as boolean, totalItems: page['total_items'] as number, lawNames: parseLawNames(place['laws']) })
    if (metadata.quiet) {
      things.clear()
      hasMore = false
      locallyTruncated = false
      break
    }
    for (const item of envelope.things) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const name = typeof row['name'] === 'string' ? row['name'].trim() : ''
      if (!Number.isSafeInteger(row['id']) || (row['id'] as number) < 1 || row['place_id'] !== id || !name) continue
      const hasDrawing = typeof row['has_drawing'] === 'boolean' ? row['has_drawing'] : undefined
      const thing = Object.freeze({ id: row['id'] as number, name, placeId: id, hasDrawing })
      if (things.has(thing.id) || things.size < MAX_ROOM_THINGS) things.set(thing.id, thing)
      else locallyTruncated = true
    }
    hasMore = page['has_more'] as boolean
    if (!hasMore || things.size >= MAX_ROOM_THINGS) break
    const cursor = outlineCursor(page, id)
    if (cursor === null) {
      throw new Error(`place outline ${id} page ${pageNumber} has invalid next_before_thing_id`)
    }
    if (cursors.has(cursor)) {
      throw new Error(`place outline ${id} page ${pageNumber} repeated next_before_thing_id ${String(cursor)}`)
    }
    cursors.add(cursor)
    url = fixture ? `${base}-before-${String(cursor)}.json`
      : `${base}?view=outline&before_thing_id=${String(cursor)}`
  }
  if (!metadata) throw new Error(`the city returned an invalid place outline ${id}`)
  return Object.freeze({ ...metadata, things: Object.freeze([...things.values()]), hasMore: hasMore || locallyTruncated })
}

function outlineCursor(page: Record<string, unknown>, id: number): number | null {
  const direct = page['next_before_thing_id']
  if (Number.isSafeInteger(direct) && (direct as number) > 0) return direct as number
  if (typeof page['next'] !== 'string') return null
  let next: URL
  try { next = new URL(page['next'], CITY_ORIGIN) } catch { return null }
  const allowed = [...next.searchParams.keys()].every(key => key === 'view' || key === 'before_thing_id')
  const cursor = Number(next.searchParams.get('before_thing_id'))
  return next.origin === CITY_ORIGIN && next.pathname === `/api/place/${String(id)}`
    && next.searchParams.get('view') === 'outline' && allowed && Number.isSafeInteger(cursor) && cursor > 0 ? cursor : null
}
