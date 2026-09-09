import type { ReplayEvent } from './city/types.ts'

export type CurrentLaw = Readonly<{ traitId: number; name: string; sourcePlaceId: number; position: number }>
export type BlockableAction = 'talk' | 'move' | 'use' | 'give' | 'consume' | 'make'
export type BlockedAttempt = Readonly<{ changeId: string; actor: string; action: BlockableAction }>
export type BlockMoment = Readonly<{ attempt: BlockedAttempt; expiresAt: number }>
export type PixelRect = Readonly<{ x: number; y: number; width: number; height: number; color: number }>

const DURATION_MS = 4_400

export function parseCurrentLaws(value: unknown): readonly CurrentLaw[] | null {
  if (!Array.isArray(value)) return null
  const laws: CurrentLaw[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>; const name = typeof row['name'] === 'string' ? row['name'].trim() : ''
    if (!positive(row['traitId']) || !name || !positive(row['sourcePlaceId']) || !Number.isSafeInteger(row['position'])
      || (row['position'] as number) < 0 || !Object.hasOwn(row, 'recipe')
      || (row['recipe'] !== null && typeof row['recipe'] !== 'object')) return null
    laws.push(Object.freeze({ traitId: row['traitId'] as number, name, sourcePlaceId: row['sourcePlaceId'] as number,
      position: row['position'] as number }))
  }
  return Object.freeze(laws)
}

export function parseLawNames(value: unknown): readonly string[] | null {
  const laws = parseCurrentLaws(value)
  return laws && Object.freeze(laws.map(law => law.name))
}

export function rememberCurrentLaws(current: ReadonlyMap<number, readonly string[] | null>, placeId: number,
  names: readonly string[] | null): ReadonlyMap<number, readonly string[] | null> {
  const next = new Map(current); next.set(placeId, names); return next
}

export function invalidateCurrentLaws(current: ReadonlyMap<number, readonly string[] | null>): ReadonlyMap<number, readonly string[] | null> {
  return new Map([...current.keys()].map(placeId => [placeId, null] as const))
}

export function currentLawStatus(current: ReadonlyMap<number, readonly string[] | null>, placeId: number | null,
  roomName: string | null, live: boolean): string {
  if (!live || placeId === null || !roomName || !current.has(placeId)) return ''
  const names = current.get(placeId) ?? null
  return names === null ? `Laws last read for ${roomName}: unknown.`
    : `Laws last read for ${roomName}: ${names.length ? shorten(names.join(', ')) : 'none'}.`
}

export function blockedAttemptFor(event: ReplayEvent): BlockedAttempt | null {
  const actor = typeof event.actor === 'string' ? event.actor.trim() : ''
  const detail = event.detail
  const actions: readonly string[] = ['talk', 'move', 'use', 'give', 'consume', 'make']
  if (event.kind !== 'action' || !actor || typeof detail.action !== 'string' || !actions.includes(detail.action)
    || detail.status !== 'blocked' || !positive(detail.action_id)) return null
  return Object.freeze({ changeId: event.change_id, actor, action: detail.action as BlockableAction })
}

export function blockDuration(): number {
  return DURATION_MS
}

export const blockedAttemptDuration = blockDuration

export function lockCells(): readonly PixelRect[] {
  const cells = [{ x: 2, y: 0, width: 6, height: 2, color: 0x412f2b },
    { x: 0, y: 2, width: 2, height: 5, color: 0x412f2b }, { x: 8, y: 2, width: 2, height: 5, color: 0x412f2b },
    { x: 0, y: 6, width: 10, height: 8, color: 0xc9554d }, { x: 4, y: 9, width: 2, height: 4, color: 0x412f2b }]
  return Object.freeze(cells.map(cell => Object.freeze(cell)))
}

function positive(value: unknown): boolean { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 }
function shorten(value: string): string {
  const characters = Array.from(value); return characters.length <= 220 ? value : `${characters.slice(0, 219).join('')}…`
}
