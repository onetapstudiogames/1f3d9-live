import { CITY_ORIGIN } from './api.ts'
import type { ReplayDetail, ReplayEvent } from './types.ts'

export type ChangesPage = Readonly<{
  marker: string; nextSince: string; hasMore: boolean; unchanged: boolean; events: readonly ReplayEvent[]
}>
export type NoteExcerpt = Readonly<{ id: number; author: string; placeId: number; text: string; cut: boolean }>

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function marker(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value))
}

export function parseChangesPage(value: unknown): ChangesPage {
  if (!object(value) || !marker(value['change_marker']) || !marker(value['next_since'])
    || typeof value['has_more'] !== 'boolean' || typeof value['unchanged'] !== 'boolean'
    || !Array.isArray(value['changes'])) throw new Error('The changes answer is incomplete.')
  const checkpoint = value['change_marker']
  const next = value['next_since']
  let previous = 0
  const events = value['changes'].map((row: unknown): ReplayEvent => {
    if (!object(row) || !marker(row['change_id']) || Number(row['change_id']) <= previous
      || typeof row['kind'] !== 'string' || !row['kind'].trim() || !object(row['detail'])
      || (row['actor'] !== null && typeof row['actor'] !== 'string')
      || typeof row['created_at'] !== 'string' || !Number.isFinite(Date.parse(row['created_at']))) {
      throw new Error('The changes answer has an invalid or out-of-order row.')
    }
    previous = Number(row['change_id'])
    // Changes omit the ledger event ID. This internal fallback uses the recorded change ID;
    // it is only a stable simulation key, never presented as a separate city event number.
    const eventId = row['event_id'] ?? previous
    if (typeof eventId !== 'number' || !Number.isSafeInteger(eventId) || eventId < 1) {
      throw new Error('The changes answer has an invalid event reference.')
    }
    return Object.freeze({
      actor: row['actor'], at: row['created_at'], change_id: row['change_id'], event_id: eventId,
      kind: row['kind'], detail: Object.freeze({ ...row['detail'] }) as ReplayDetail,
    })
  })
  if (Number(next) > Number(checkpoint) || previous > Number(next)
    || (value['has_more'] && (!events.length || Number(next) >= Number(checkpoint)))
    || (value['unchanged'] && (events.length > 0 || value['has_more']))) {
    throw new Error('The changes answer has conflicting continuation markers.')
  }
  return Object.freeze({ marker: checkpoint, nextSince: next, hasMore: value['has_more'],
    unchanged: value['unchanged'], events: Object.freeze(events) })
}

function browserSearch(): string { return typeof window === 'undefined' ? '' : window.location.search }
function fixture(params: URLSearchParams): boolean { return params.has('replay') || params.has('census') }
function readOptions(): RequestInit {
  return { method: 'GET', credentials: 'omit', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }
}

export async function fetchChanges(since: string, search: string = browserSearch()): Promise<ChangesPage> {
  if (!marker(since)) throw new Error('The changes marker must be a non-negative safe integer.')
  const params = new URLSearchParams(search)
  const url = params.get('changes') || (fixture(params) ? '/fixtures/changes-live.json'
    : `${CITY_ORIGIN}/api/changes?since=${since}&limit=200`)
  const response = await fetch(url, readOptions())
  if (!response.ok) throw new Error(`The city answered ${response.status} for changes.`)
  return parseChangesPage(await response.json())
}

export function parseNoteExcerpt(value: unknown, id: number): NoteExcerpt {
  const note = object(value) ? value['note'] : undefined
  if (!Number.isSafeInteger(id) || id < 1 || !object(note) || note['id'] !== id || typeof note['author'] !== 'string' || !note['author'].trim()
    || typeof note['body'] !== 'string' || typeof note['place_id'] !== 'number'
    || !Number.isSafeInteger(note['place_id']) || note['place_id'] < 1) {
    throw new Error('The public note answer is incomplete or names a different note.')
  }
  return Object.freeze({ id, author: note['author'], placeId: note['place_id'], text: note['body'], cut: false })
}

export function createNoteExcerptLoader(search: string = browserSearch()): (id: number) => Promise<NoteExcerpt | null> {
  const params = new URLSearchParams(search)
  const root = params.get('notes') || (fixture(params) ? '/fixtures/notes' : null)
  const cache = new Map<number, Promise<NoteExcerpt | null>>()
  const read = async (id: number): Promise<NoteExcerpt | null> => {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('The note request needs a positive safe integer ID.')
    const url = root ? `${root.replace(/\/$/, '')}/note-${id}.json` : `${CITY_ORIGIN}/api/note/${id}`
    const response = await fetch(url, readOptions())
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`The city answered ${response.status} for note ${id}.`)
    if (root && response.headers.get('content-type')?.includes('text/html')) return null
    return parseNoteExcerpt(await response.json(), id)
  }
  return id => {
    const cached = cache.get(id)
    if (cached) return cached
    const pending = read(id)
    cache.set(id, pending)
    return pending
  }
}
