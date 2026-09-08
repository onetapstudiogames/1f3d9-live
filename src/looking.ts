import type { Resident } from './city/types.ts'

export type LookingMoment = Readonly<{
  key: string
  residentId: number
  roomId: number
  name: string
  expiresAt: number
}>

export type LookingState = Readonly<{ burstsByResident: Readonly<Record<string, string>> }>

type StepLookingInput = Readonly<{
  residents: readonly Resident[]
  wallNow: number
  playingLive: boolean
  recordedPlaceByResident: ReadonlyMap<number, number>
  quietPlaceIds?: ReadonlySet<number>
}>

type ParsedLook = Readonly<{ key: string; roomId: number; expiresAt: number; present: boolean }>

function parseLook(resident: Resident, wallNow: number): ParsedLook | null {
  const value = resident.looking
  if (!value || typeof value !== 'object') return null
  const roomId = Number(value.place_id)
  const startedAt = Date.parse(value.started_at)
  const expiresAt = Date.parse(value.expires_at)
  if (!Number.isSafeInteger(roomId) || roomId < 1 || roomId !== resident.current_place_id
    || !Number.isFinite(startedAt) || !Number.isFinite(expiresAt)
    || expiresAt <= startedAt || expiresAt <= wallNow
    || expiresAt - Math.max(wallNow, startedAt) > 60_000
    || startedAt - wallNow > 60_000) return null
  return Object.freeze({
    key: `looking:${resident.id}:${roomId}:${new Date(startedAt).toISOString()}`,
    roomId,
    expiresAt,
    present: startedAt <= wallNow + 5_000,
  })
}

/** Tracks temporary public looking presence without turning it into replay history. */
export function stepLookingPresence(previous: LookingState | undefined, input: StepLookingInput): Readonly<{
  state: LookingState
  active: readonly LookingMoment[]
  moments: readonly LookingMoment[]
}> {
  if (!Number.isFinite(input.wallNow)) throw new TypeError('looking wall time must be finite')
  const next: Record<string, string> = {}
  const active: LookingMoment[] = []
  const moments: LookingMoment[] = []
  const seenResidents = new Set<number>()
  for (const resident of input.residents) {
    if (!Number.isSafeInteger(resident.id) || resident.id < 1 || seenResidents.has(resident.id)) continue
    seenResidents.add(resident.id)
    const look = parseLook(resident, input.wallNow)
    if (!look) continue
    next[String(resident.id)] = look.key
    const name = typeof resident.handle === 'string' ? resident.handle.trim() : ''
    const eligible = input.playingLive && look.present && name.length > 0
      && input.recordedPlaceByResident.get(resident.id) === look.roomId
      && !input.quietPlaceIds?.has(look.roomId)
    if (!eligible) continue
    const moment = Object.freeze({ key: look.key, residentId: resident.id, roomId: look.roomId, name, expiresAt: look.expiresAt })
    active.push(moment)
    if (previous && previous.burstsByResident[String(resident.id)] !== look.key) moments.push(moment)
  }
  return Object.freeze({
    state: Object.freeze({ burstsByResident: Object.freeze(next) }),
    active: Object.freeze(active),
    moments: Object.freeze(moments),
  })
}
