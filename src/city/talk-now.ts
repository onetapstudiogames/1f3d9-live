import { CITY_ORIGIN } from './api.ts'
import { talkCheckMs } from '../talk-tick.ts'

export type ListeningMark = Readonly<{
  placeId: number
  residentId: number
  handle: string
  listeningUntil: string
}>

export type TalkNow = Readonly<{
  lineMarker: string
  checkMs: number
  listening: readonly ListeningMark[]
}>

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function decimalMarker(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value)
}

function listeningMark(value: unknown): ListeningMark | null {
  if (!object(value) || !Number.isSafeInteger(value['place_id']) || (value['place_id'] as number) < 1
    || !Number.isSafeInteger(value['resident_id']) || (value['resident_id'] as number) < 1
    || typeof value['handle'] !== 'string' || !/^[a-z0-9][a-z0-9-]{2,31}$/.test(value['handle'])
    || typeof value['listening_until'] !== 'string' || !Number.isFinite(Date.parse(value['listening_until']))) return null
  return Object.freeze({ placeId: value['place_id'] as number, residentId: value['resident_id'] as number,
    handle: value['handle'], listeningUntil: value['listening_until'] })
}

export function parseTalkNow(value: unknown): TalkNow {
  if (!object(value) || !decimalMarker(value['line_marker']) || !Array.isArray(value['listening'])) {
    throw new Error('The talk check answer is incomplete.')
  }
  return Object.freeze({ lineMarker: value['line_marker'], checkMs: talkCheckMs(value['check_interval_ms']),
    listening: Object.freeze(value['listening'].flatMap((row: unknown) => {
      const mark = listeningMark(row)
      return mark ? [mark] : []
    })) })
}

function browserSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search
}

function fixture(params: URLSearchParams): boolean {
  return params.has('census')
}

function readOptions(): RequestInit {
  return { method: 'GET', credentials: 'omit', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }
}

export async function fetchTalkNow(search: string = browserSearch()): Promise<TalkNow> {
  const params = new URLSearchParams(search)
  const url = params.get('talk') || (fixture(params) ? 'fixtures/talk-now.json' : `${CITY_ORIGIN}/api/talk/now`)
  const response = await fetch(url, readOptions())
  if (!response.ok) throw new Error(`The city answered ${response.status} for the talk check.`)
  return parseTalkNow(await response.json())
}
