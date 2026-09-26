import { CITY_ORIGIN } from './api.ts'
import type { ReplayDetail, ReplayEvent } from './types.ts'

export type ChangesPage = Readonly<{
  marker: string; nextSince: string; hasMore: boolean; unchanged: boolean; events: readonly ReplayEvent[]
}>
// `readInPerson` marks a walk-to-read note whose `text` is only its public first line.
export type NoteExcerpt = Readonly<{ id: number; author: string; placeId: number; text: string; cut: boolean; readInPerson?: true; removed?: true }>
export type RoomLine = Readonly<{ id: number; placeId: number; author: string; body: string; createdAt: string }>
export type RoomLinesPage = Readonly<{ lines: readonly RoomLine[]; removedIds: readonly number[]; dropped: number }>
export const ROOM_LINES_LIMIT = 50

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
function fixture(params: URLSearchParams): boolean { return params.has('census') }
function readOptions(): RequestInit {
  return { method: 'GET', credentials: 'omit', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }
}

export async function fetchChanges(since: string, search: string = browserSearch()): Promise<ChangesPage> {
  if (!marker(since)) throw new Error('The changes marker must be a non-negative safe integer.')
  const params = new URLSearchParams(search)
  const url = params.get('changes') || (fixture(params) ? 'fixtures/changes-live.json'
    : `${CITY_ORIGIN}/api/changes?since=${since}&limit=200`)
  const response = await fetch(url, readOptions())
  if (!response.ok) throw new Error(`The city answered ${response.status} for changes.`)
  return parseChangesPage(await response.json())
}

export function parseNoteExcerpt(value: unknown, id: number): NoteExcerpt {
  const note = object(value) ? value['note'] : undefined
  if (!Number.isSafeInteger(id) || id < 1 || !object(note) || note['id'] !== id || typeof note['author'] !== 'string' || !note['author'].trim()
    || typeof note['place_id'] !== 'number' || !Number.isSafeInteger(note['place_id']) || note['place_id'] < 1) {
    throw new Error('The public note answer is incomplete or names a different note.')
  }
  const common = { id, author: note['author'], placeId: note['place_id'] }
  if (note['moderated'] === true) return Object.freeze({ ...common, text: '', cut: false, removed: true })
  if (typeof note['body'] === 'string') return Object.freeze({ ...common, text: note['body'], cut: false })
  // A walk-to-read note read from afar has no body: only its first line and the city's
  // read_in_person sentence. Keep the first line; never guess at the rest.
  if (note['body'] === undefined && note['walk_to_read'] === true && typeof note['first_line'] === 'string'
    && typeof note['read_in_person'] === 'string' && note['read_in_person'].trim()) {
    return Object.freeze({ ...common, text: note['first_line'], cut: false, readInPerson: true })
  }
  throw new Error('The public note answer is incomplete or names a different note.')
}

export function createNoteExcerptLoader(search: string = browserSearch()): (id: number) => Promise<NoteExcerpt | null> {
  const params = new URLSearchParams(search)
  const root = params.get('notes') || (fixture(params) ? 'fixtures/notes' : null)
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

export function parseRoomLines(value: unknown, roomId: number): RoomLinesPage {
  if (!object(value) || !Array.isArray(value['lines'])) throw new Error('The room lines answer is incomplete.')
  const lines: RoomLine[] = []
  const removedIds: number[] = []
  let dropped = 0
  for (const row of value['lines']) {
    if (object(row) && row['moderated'] === true && Number.isSafeInteger(row['id']) && (row['id'] as number) > 0) {
      removedIds.push(row['id'] as number)
      continue
    }
    if (!object(row) || !Number.isSafeInteger(row['id']) || (row['id'] as number) < 1
      || row['place_id'] !== roomId || typeof row['author'] !== 'string' || !/^[a-z0-9][a-z0-9-]{2,31}$/.test(row['author'])
      || typeof row['body'] !== 'string' || !row['body'].length || /[\r\n]/.test(row['body'])
      || typeof row['created_at'] !== 'string' || !Number.isFinite(Date.parse(row['created_at']))) {
      dropped += 1
      continue
    }
    lines.push(Object.freeze({ id: row['id'] as number, placeId: roomId, author: row['author'], body: row['body'], createdAt: row['created_at'] }))
  }
  lines.sort((a, b) => a.id - b.id)
  removedIds.sort((a, b) => a - b)
  return Object.freeze({ lines: Object.freeze(lines), removedIds: Object.freeze(removedIds), dropped })
}

export async function fetchRoomLines(roomId: number, lineMarker: string, search: string = browserSearch()): Promise<RoomLinesPage> {
  const params = new URLSearchParams(search)
  const root = params.get('roomlines') || (fixture(params) ? 'fixtures/room-lines' : null)
  const url = root ? `${root.replace(/\/$/, '')}/lines-${roomId}-${lineMarker}.json`
    : `${CITY_ORIGIN}/api/window?collection=lines&place_id=${roomId}&limit=${ROOM_LINES_LIMIT}&after_change_marker=${lineMarker}`
  const response = await fetch(url, readOptions())
  if (!response.ok) throw new Error(`The city answered ${response.status} for the room's lines.`)
  return parseRoomLines(await response.json(), roomId)
}
