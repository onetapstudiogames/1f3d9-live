import { CITY_ORIGIN } from './api.ts'

// The city's season and holiday theme (GET /api/season, city decision 144).
// Everything here is pure: reading the shape, choosing where to read it, and
// deciding when to read it again. The page only decorates its frame with it;
// the theme is never a record fact and never enters the room picture.

export const LIVE_TOKEN_NAMES = Object.freeze([
  '--frame', '--frame-edge', '--control', '--control-hover', '--accent', '--quiet',
] as const)
export type LiveTokenName = typeof LIVE_TOKEN_NAMES[number]
export type LiveTokens = Readonly<Record<LiveTokenName, string>>

export type SeasonWord = Readonly<{
  word: string
  key: string
  image: string
  width: number
  height: number
  heightEm: number
  dropEm: number
}>
export type SeasonSloganPart = string | SeasonWord

export type LiveSeason = Readonly<{
  date: string
  // Milliseconds since the epoch when the city's UTC day ends.
  nextChangeAt: number
  quiet: boolean
  tokens: LiveTokens | null
  icon: Readonly<{ url: string; label: string; dressed: boolean }>
  slogan: Readonly<{ text: string; parts: readonly SeasonSloganPart[] }>
}>

const DATE = /^\d{4}-\d{2}-\d{2}$/u
const HEX = /^#[0-9a-fA-F]{6}$/u
// A root-relative path on the city (or, in fixture mode, on the page's own origin).
const ASSET_PATH = /^\/(?!\/)[A-Za-z0-9._+/-]{1,200}$/u
const MAX_PARTS = 25
const MAX_TEXT = 200
const MAX_WORD = 40
const MAX_EM = 4
const MAX_PIXELS = 2000

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function safeAssetPath(value: unknown): value is string {
  return typeof value === 'string' && ASSET_PATH.test(value) && !value.split('/').includes('..')
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function parseTokens(value: unknown): LiveTokens | null | undefined {
  if (value === null) return null
  const palette = record(value)
  const live = record(palette?.['live'])
  if (!live) return undefined
  const tokens: Partial<Record<LiveTokenName, string>> = {}
  for (const name of LIVE_TOKEN_NAMES) {
    const color = live[name]
    if (typeof color !== 'string' || !HEX.test(color)) return undefined
    tokens[name] = color.toLowerCase()
  }
  return Object.freeze(tokens as LiveTokens)
}

function parseWord(value: unknown): SeasonWord | null {
  const word = record(value)
  if (!word || !boundedText(word['word'], MAX_WORD) || !boundedText(word['key'], MAX_WORD)
    || !safeAssetPath(word['image']) || !finiteIn(word['width'], 0.01, MAX_PIXELS)
    || !finiteIn(word['height'], 0.01, MAX_PIXELS) || !finiteIn(word['height_em'], 0.01, MAX_EM)
    || !finiteIn(word['drop_em'], -MAX_EM, MAX_EM)) return null
  return Object.freeze({
    word: word['word'], key: word['key'], image: word['image'], width: word['width'], height: word['height'],
    heightEm: word['height_em'], dropEm: word['drop_em'],
  })
}

function parseParts(value: unknown): readonly SeasonSloganPart[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PARTS) return null
  const parts: SeasonSloganPart[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      if (item.length > MAX_TEXT) return null
      parts.push(item)
      continue
    }
    const word = parseWord(item)
    if (!word) return null
    parts.push(word)
  }
  return Object.freeze(parts)
}

// The season read, or null when anything in it is unexpected. A null keeps the
// page's current look; it is never shown as a read issue.
export function parseSeason(value: unknown): LiveSeason | null {
  const body = record(value)
  if (!body || typeof body['date'] !== 'string' || !DATE.test(body['date'])
    || typeof body['next_change_at'] !== 'string' || typeof body['quiet'] !== 'boolean') return null
  const nextChangeAt = Date.parse(body['next_change_at'])
  if (!Number.isFinite(nextChangeAt)) return null
  const tokens = parseTokens(body['palette'])
  if (tokens === undefined) return null
  const icon = record(body['icon'])
  if (!icon || !safeAssetPath(icon['url']) || !boundedText(icon['label'], MAX_TEXT)
    || typeof icon['dressed'] !== 'boolean') return null
  const slogan = record(body['slogan'])
  const parts = parseParts(slogan?.['parts'])
  if (!slogan || !parts || !boundedText(slogan['text'], MAX_TEXT)) return null
  // A quiet day takes everything down, whatever else the body says.
  const quiet = body['quiet']
  return Object.freeze({
    date: body['date'],
    nextChangeAt,
    quiet,
    tokens: quiet ? null : tokens,
    icon: Object.freeze({ url: icon['url'], label: icon['label'], dressed: !quiet && icon['dressed'] }),
    slogan: Object.freeze({ text: slogan['text'], parts }),
  })
}

function seasonFixture(search: string): string | null {
  const value = new URLSearchParams(search).get('season')
  if (!value || value.includes('://') || value.startsWith('//') || value.includes('\\')) return null
  return value
}

// Where to read the theme. `?season=` names a saved fixture; any other fixture
// run (`?census=`) reads no theme, so saved pictures keep the default look.
export function seasonUrl(search: string): string | null {
  const fixture = seasonFixture(search)
  if (fixture) return fixture
  if (new URLSearchParams(search).has('census')) return null
  return `${CITY_ORIGIN}/api/season`
}

// Season files live on the city; a saved fixture keeps them on the page's origin.
export function seasonAssetUrl(path: string, search: string): string {
  return seasonFixture(search) ? path : `${CITY_ORIGIN}${path}`
}

export type SloganNode =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'word'; alt: string; src: string; width: number; height: number; heightEm: number; dropEm: number }>

// The nodes the frame shows: plain text runs and one image per slogan word,
// each image's alt text equal to its word. A plain or quiet day shows none.
export function sloganNodes(season: LiveSeason, search: string): readonly SloganNode[] {
  if (!season.icon.dressed) return []
  return season.slogan.parts.map(part => typeof part === 'string'
    ? Object.freeze({ kind: 'text' as const, text: part })
    : Object.freeze({
      kind: 'word' as const, alt: part.word, src: seasonAssetUrl(part.image, search),
      width: Math.round(part.width), height: Math.round(part.height), heightEm: part.heightEm, dropEm: part.dropEm,
    }))
}

export const SEASON_CHECK_MS = 30_000
export const SEASON_RETRY_AFTER_CHANGE_MS = 60_000
export const SEASON_RETRY_AFTER_FAILURE_MS = 5 * 60_000

export type SeasonReadState = Readonly<{
  lastAttemptAt: number | null
  // The served day's end after a good read; null after a failed one.
  nextChangeAt: number | null
}>

export const INITIAL_SEASON_READ: SeasonReadState = Object.freeze({ lastAttemptAt: null, nextChangeAt: null })

// One read at start, then one when the served UTC day has ended. An edge copy
// can still serve yesterday for a few minutes, so a stale answer is read
// again a minute later. A failed read is retried every five minutes.
export function seasonReadDue(state: SeasonReadState, now: number): boolean {
  if (state.lastAttemptAt === null) return true
  const since = now - state.lastAttemptAt
  if (state.nextChangeAt === null) return since >= SEASON_RETRY_AFTER_FAILURE_MS
  return now >= state.nextChangeAt && since >= SEASON_RETRY_AFTER_CHANGE_MS
}
