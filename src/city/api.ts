import type { CensusPage, Drawing, PlaceOutline, ReplayFile, Resident, Thing } from './types.ts'
import { parseNameHistory, type NameSpan } from '../places.ts'

export const CITY_ORIGIN = 'https://1f3d9.com'
const READ_TIMEOUT_MS = 15_000

function readOptions(): RequestInit {
  return { credentials: 'omit', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(READ_TIMEOUT_MS) }
}

// ?replay=<url> lets tests and the smoke check read a saved fixture instead of the live city.
export function replayUrl(search: string = window.location.search): string {
  const override = new URLSearchParams(search).get('replay')
  return override && override.length > 0 ? override : `${CITY_ORIGIN}/api/replay?span=24h`
}

export async function fetchReplay(url: string = replayUrl()): Promise<ReplayFile> {
  const response = await fetch(url, readOptions())
  if (!response.ok) throw new Error(`the city answered ${response.status} for the replay file`)
  const value = await response.json() as unknown
  if (!value || typeof value !== 'object') throw new Error('the city returned an invalid replay file: expected an object')
  const replay = value as Record<string, unknown>
  const map = replay['map'] as Record<string, unknown> | null
  if (typeof replay['window_start'] !== 'string' || typeof replay['window_end'] !== 'string'
    || !map || !Array.isArray(map['places']) || !replay['start'] || typeof replay['start'] !== 'object'
    || Array.isArray(replay['start']) || !Array.isArray(replay['timeline'])) {
    throw new Error('the city returned an invalid replay file: missing map, window, start, or timeline')
  }
  return value as ReplayFile
}

function searchValue(search: string, name: string): string | null {
  return new URLSearchParams(search).get(name)
}

function browserSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search
}

function fixtureMode(search: string): boolean {
  const params = new URLSearchParams(search)
  return params.has('replay') || params.has('census')
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

// Only ?drawings= sends art to saved files. A record override alone (?replay= or ?census=)
// leaves every drawing with the live city, so a saved day never quietly loses its faces.
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
    const pending = fetchDrawing(type, id, search)
    cache.set(id, pending)
    return pending
  }
}

function thingUrl(id: number, search: string): string {
  const fixtureRoot = searchValue(search, 'things')
  const root = fixtureRoot || (fixtureMode(search) ? '/fixtures/things' : null)
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

function placeHistoryUrl(id: number, search: string): { url: string, fixture: boolean } {
  const fixtureRoot = searchValue(search, 'places')
  const root = fixtureRoot || (fixtureMode(search) ? '/fixtures/places' : null)
  return root
    ? { url: `${root.replace(/\/$/, '')}/place-${id}.json`, fixture: true }
    : { url: `${CITY_ORIGIN}/api/map?view=outline&parent_id=${id}&limit=1`, fixture: false }
}

async function fetchNameHistory(id: number, search: string): Promise<readonly NameSpan[] | null> {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error('invalid place history request: expected a positive safe integer id')
  }
  const request = placeHistoryUrl(id, search)
  const response = await fetch(request.url, readOptions())
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`the city answered ${response.status} for place history ${id}`)
  if (request.fixture && response.headers.get('content-type')?.toLowerCase().includes('text/html')) return null
  const value = await response.json() as unknown
  const envelope = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const place = envelope?.['place']
  if (!place || typeof place !== 'object') throw new Error(`the city returned an invalid name history for place ${id}`)
  const record = place as Record<string, unknown>
  const history = parseNameHistory(record['name_history'])
  if (record['id'] !== id || history === null) {
    throw new Error(`the city returned an invalid name history for place ${id}`)
  }
  return history
}

export function createNameHistoryLoader(
  search: string = browserSearch(),
): (id: number) => Promise<readonly NameSpan[] | null> {
  const cache = new Map<number, Promise<readonly NameSpan[] | null>>()
  return id => {
    const cached = cache.get(id)
    if (cached) return cached
    const pending = fetchNameHistory(id, search)
    cache.set(id, pending)
    return pending
  }
}

export function createPlaceOutlineLoader(search: string = browserSearch()): (id: number) => Promise<PlaceOutline | null> {
  const cache = new Map<number, Promise<PlaceOutline | null>>()
  return id => {
    const cached = cache.get(id)
    if (cached) return cached
    const pending = fetchPlaceOutline(id, search)
    cache.set(id, pending)
    return pending
  }
}

async function fetchPlaceOutline(id: number, search: string): Promise<PlaceOutline | null> {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('invalid place outline request: expected a positive safe integer id')
  const root = searchValue(search, 'places') || (fixtureMode(search) ? '/fixtures/places' : null)
  const fixture = Boolean(root)
  const url = root ? `${root.replace(/\/$/, '')}/place-${id}.json` : `${CITY_ORIGIN}/api/place/${id}?view=outline`
  const response = await fetch(url, readOptions())
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`the city answered ${response.status} for place outline ${id}`)
  if (fixture && response.headers.get('content-type')?.toLowerCase().includes('text/html')) return null
  const value = await response.json() as unknown
  const envelope = value && typeof value === 'object' ? value as Record<string, unknown> : null
  const place = envelope?.['place'] as Record<string, unknown> | undefined
  const page = envelope?.['things_page'] as Record<string, unknown> | undefined
  if (place?.['id'] !== id || typeof place['quiet'] !== 'boolean' || !Array.isArray(envelope?.['things']) || !page
    || !Number.isSafeInteger(page['total_items']) || (page['total_items'] as number) < 0 || typeof page['has_more'] !== 'boolean') {
    throw new Error(`the city returned an invalid place outline ${id}`)
  }
  const things = envelope.things.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const name = typeof row['name'] === 'string' ? row['name'].trim() : ''
    return Number.isSafeInteger(row['id']) && (row['id'] as number) > 0 && row['place_id'] === id && name
      ? [{ id: row['id'] as number, name, placeId: id, hasDrawing: row['has_drawing'] === true }] : []
  })
  return Object.freeze({ placeId: id, quiet: place['quiet'], things: Object.freeze(things), totalItems: page['total_items'] as number, hasMore: page['has_more'] as boolean })
}
