import type { CensusPage, Drawing, ReplayFile, Resident } from './types.ts'

export const CITY_ORIGIN = 'https://1f3d9.com'
const READ_TIMEOUT_MS = 15_000

function readOptions(): RequestInit {
  return { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(READ_TIMEOUT_MS) }
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

function drawingUrl(type: 'resident' | 'place', id: number, search: string): string {
  const fixtureRoot = searchValue(search, 'drawings')
  return fixtureRoot
    ? `${fixtureRoot.replace(/\/$/, '')}/${type}-${id}.json`
    : `${CITY_ORIGIN}/api/drawing/${type}/${id}`
}

export async function fetchDrawing(type: 'resident' | 'place', id: number, search: string = browserSearch()): Promise<Drawing | null> {
  if ((type !== 'resident' && type !== 'place') || !Number.isInteger(id) || id < 1) {
    throw new Error('invalid drawing request: expected a resident or place and a positive integer id')
  }
  const response = await fetch(drawingUrl(type, id, search), readOptions())
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`the city answered ${response.status} for the ${type} drawing ${id}`)
  const fixtureRoot = searchValue(search, 'drawings')
  if (fixtureRoot && response.headers.get('content-type')?.toLowerCase().includes('text/html')) return null
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
  type: 'resident' | 'place' = 'resident',
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
