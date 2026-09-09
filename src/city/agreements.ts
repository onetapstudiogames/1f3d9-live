import { CITY_ORIGIN } from './api.ts'
import type { ReplayEvent } from './types.ts'

export type AgreementPair = Readonly<{ agreementId: number; parties: readonly [string, string] }>

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function signatureRef(event: ReplayEvent): { agreementId: number; actor: string; time: number } | null {
  const id = event.detail.agreement_id
  if (event.kind !== 'agreement_sign' || typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1
    || typeof event.actor !== 'string' || !event.actor.trim() || !Number.isFinite(Date.parse(event.at))) return null
  return { agreementId: id, actor: event.actor.trim(), time: Date.parse(event.at) }
}

export function parseAgreementPair(value: unknown, event: ReplayEvent): AgreementPair | null {
  const ref = signatureRef(event)
  if (!ref) return null
  if (!object(value) || !Array.isArray(value['agreements'])) throw new Error('The public agreement list is incomplete.')
  const matches = value['agreements'].filter((row: unknown) => object(row) && row['id'] === ref.agreementId)
  if (matches.length !== 1) return null
  const row = matches[0] as Record<string, unknown>
  const parties = row['parties']
  // A current pair with no accessions is still the original named pair. Never project a
  // later joiner back into an earlier signature, or choose two people from a larger group.
  if (!Array.isArray(parties) || parties.length !== 2 || !parties.every((name: unknown) =>
    typeof name === 'string' && name.trim().length > 0 && name.trim() === name)
    || parties[0] === parties[1] || !parties.includes(ref.actor)
    || !Array.isArray(row['acceded']) || row['acceded'].length !== 0
    || typeof row['created_at'] !== 'string' || !Number.isFinite(Date.parse(row['created_at']))
    || Date.parse(row['created_at']) > ref.time) return null
  return Object.freeze({ agreementId: ref.agreementId, parties: Object.freeze([parties[0], parties[1]]) as readonly [string, string] })
}

function browserSearch(): string { return typeof window === 'undefined' ? '' : window.location.search }

export function createAgreementPairLoader(search = browserSearch()): (event: ReplayEvent) => Promise<AgreementPair | null> {
  const params = new URLSearchParams(search)
  const fixture = params.get('agreements') || (params.has('census') ? 'fixtures/agreements.json' : null)
  const cache = new Map<string, Promise<AgreementPair | null>>()
  const read = async (event: ReplayEvent): Promise<AgreementPair | null> => {
    const ref = signatureRef(event)
    if (!ref) return null
    const query = new URLSearchParams({ party: ref.actor, limit: '200' })
    const response = await fetch(fixture || `${CITY_ORIGIN}/api/agreements?${query}`, {
      method: 'GET', credentials: 'omit', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`The city answered ${response.status} for agreements.`)
    if (fixture && response.headers.get('content-type')?.includes('text/html')) return null
    // One bounded page: an older omitted agreement remains unlinked, never guessed.
    return parseAgreementPair(await response.json(), event)
  }
  return event => {
    // A later signature gets a fresh read: the agreement may have gained another party.
    const key = JSON.stringify([event.kind, event.change_id, event.detail.agreement_id, event.actor, event.at])
    const cached = cache.get(key)
    if (cached) return cached
    const pending = read(event)
    cache.set(key, pending)
    return pending
  }
}
