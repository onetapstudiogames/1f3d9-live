import { CITY_ORIGIN } from './api.ts'
import type { CurrentPlace } from './types.ts'

const READ_TIMEOUT_MS = 15_000

function browserSearch(): string { return typeof window === 'undefined' ? '' : window.location.search }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function marker(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value))
}
function readOptions(): RequestInit {
  return { method: 'GET', credentials: 'omit', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(READ_TIMEOUT_MS) }
}

function requirePlace(value: unknown, index: number): CurrentPlace {
  if (!object(value) || !Number.isSafeInteger(value['id']) || (value['id'] as number) < 1
    || typeof value['name'] !== 'string' || !(value['name'] as string).trim()
    || (value['parent_id'] !== null && (!Number.isSafeInteger(value['parent_id']) || (value['parent_id'] as number) < 1))
    || (value['owner'] !== undefined && value['owner'] !== null && typeof value['owner'] !== 'string')
    || (value['owner_id'] !== undefined && value['owner_id'] !== null
      && (!Number.isSafeInteger(value['owner_id']) || (value['owner_id'] as number) < 1))
    || typeof value['quiet'] !== 'boolean'
    || (value['has_drawing'] !== undefined && typeof value['has_drawing'] !== 'boolean')) {
    throw new Error(`the current map contains an invalid place at row ${index + 1}`)
  }
  return Object.freeze({
    id: value['id'] as number, name: (value['name'] as string).trim(), parent_id: value['parent_id'] as number | null,
    owner: value['owner'] as string | null ?? null, owner_id: value['owner_id'] as number | null ?? null,
    quiet: value['quiet'] as boolean, has_drawing: value['has_drawing'] === true,
  })
}

/** Read the complete current public place directory used by the chooser and layout. */
export async function fetchCurrentPlaces(search: string = browserSearch()): Promise<readonly CurrentPlace[]> {
  const override = new URLSearchParams(search).get('map')
  const url = override || `${CITY_ORIGIN}/api/window?view=directory`
  const response = await fetch(url, readOptions())
  if (!response.ok) throw new Error(`the city answered ${response.status} for the current map`)
  const value = await response.json() as unknown
  if (!object(value) || value['view'] !== 'directory' || !Array.isArray(value['places'])) {
    throw new Error('the city returned an invalid current map')
  }
  return Object.freeze(value['places'].map(requirePlace))
}

/** Seed the live cursor from the head. Any older rows in the answer are deliberately discarded. */
export async function fetchChangeCursor(search: string = browserSearch()): Promise<string> {
  const override = new URLSearchParams(search).get('cursor')
  const url = override || `${CITY_ORIGIN}/api/changes`
  const response = await fetch(url, readOptions())
  if (!response.ok) throw new Error(`the city answered ${response.status} for the change cursor`)
  const value = await response.json() as unknown
  if (!object(value) || !marker(value['change_marker'])) throw new Error('the city returned an invalid change cursor')
  return value['change_marker']
}
