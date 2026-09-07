import type { ReplayEvent } from './city/types.ts'
import type { Point, Room } from './ground/nested.ts'
import { BASE_SPEED, holdScale } from './replay/index.ts'

const NEWCOMER_DURATION_MS = 24 * 60 * 60 * 1_000
const SPARKLE_DURATION_MS = 1_200
const SPARKLE_FLOOR_MS = 400
const FIGURE_EDGE_INSET = 32
const FIGURE_CENTER_SEPARATION = 48

export type Sparkle = Readonly<{ shownAt: number; expiresAt: number }>

export function isNewResident(joinedAt: string | null | undefined, recordedTime: number): boolean {
  if (typeof joinedAt !== 'string' || !Number.isFinite(recordedTime)) return false
  const joinedTime = Date.parse(joinedAt)
  if (!Number.isFinite(joinedTime)) return false
  return joinedTime <= recordedTime && recordedTime < joinedTime + NEWCOMER_DURATION_MS
}

export function registrationFor(event: ReplayEvent): { id: number; handle: string; at: number } | null {
  const handle = typeof event.actor === 'string' ? event.actor.trim() : ''
  const at = Date.parse(event.at)
  const detail = event.detail
  const id = detail && typeof detail === 'object' ? detail.resident_id : undefined
  if (event.kind !== 'register' || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null
  if (handle.length === 0 || !Number.isFinite(at)) return null
  return { id, handle, at }
}

export function newcomerSpot(id: number, room: Room, occupied: readonly Point[]): Point | null {
  if (!Number.isSafeInteger(id) || id <= 0 || !validRoom(room) || !occupied.every(validPoint)) return null

  const minimumX = Math.ceil(room.standing.x + FIGURE_EDGE_INSET)
  const maximumX = Math.floor(room.standing.x + room.standing.width - FIGURE_EDGE_INSET)
  const y = room.standing.y + FIGURE_EDGE_INSET
  const candidateCount = maximumX - minimumX + 1
  if (!Number.isSafeInteger(candidateCount) || candidateCount <= 0 || !Number.isFinite(y)) return null

  const firstOffset = hashResidentId(id) % candidateCount
  const maximumAttempts = Math.min(candidateCount, occupied.length * FIGURE_CENTER_SEPARATION * 2 + 1)
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const x = minimumX + (firstOffset + attempt) % candidateCount
    if (occupied.every(point =>
      Math.abs(x - point.x) >= FIGURE_CENTER_SEPARATION ||
      Math.abs(y - point.y) >= FIGURE_CENTER_SEPARATION)) {
      return Object.freeze({ x, y })
    }
  }
  return null
}

export function sparkleFor(shownAt: number, speed: number = BASE_SPEED): Sparkle | null {
  if (!Number.isFinite(shownAt)) return null
  const duration = Math.max(SPARKLE_FLOOR_MS, SPARKLE_DURATION_MS * holdScale(speed))
  const expiresAt = shownAt + duration
  if (!Number.isFinite(expiresAt)) return null
  return Object.freeze({ shownAt, expiresAt })
}

export function sparkleAlpha(sparkle: Sparkle | null, now: number): number {
  if (sparkle === null || !Number.isFinite(now) ||
      !Number.isFinite(sparkle.shownAt) || !Number.isFinite(sparkle.expiresAt) ||
      sparkle.expiresAt <= sparkle.shownAt || now < sparkle.shownAt || now >= sparkle.expiresAt) return 0
  return Math.max(0, Math.min(1, (sparkle.expiresAt - now) / (sparkle.expiresAt - sparkle.shownAt)))
}

function validRoom(room: Room): boolean {
  if (!room || typeof room !== 'object' || !room.standing || typeof room.standing !== 'object') return false
  const values = [
    room.x, room.y, room.width, room.height,
    room.standing.x, room.standing.y, room.standing.width, room.standing.height,
  ]
  const roomRight = room.x + room.width
  const roomBottom = room.y + room.height
  const standingRight = room.standing.x + room.standing.width
  const standingBottom = room.standing.y + room.standing.height
  return values.every(Number.isFinite) && [roomRight, roomBottom, standingRight, standingBottom].every(Number.isFinite) &&
    room.width > 0 && room.height > 0 &&
    room.standing.width >= FIGURE_EDGE_INSET * 2 && room.standing.height >= FIGURE_EDGE_INSET * 2 &&
    room.standing.x >= room.x && room.standing.y >= room.y &&
    standingRight <= roomRight && standingBottom <= roomBottom
}

function validPoint(point: Point): boolean {
  return Boolean(point && typeof point === 'object' && Number.isFinite(point.x) && Number.isFinite(point.y))
}

function hashResidentId(id: number): number {
  let hash = 2_166_136_261
  for (const character of String(id)) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}
