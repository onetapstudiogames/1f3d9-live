import type { AgreementPair } from './city/agreements.ts'
import type { ReplayEvent } from './city/types.ts'
import type { NestedLayout, Point } from './ground/nested.ts'
import type { ThingReservations } from './things.ts'
import { BASE_SPEED, holdScale } from './replay/index.ts'

export type AgreementSignature = Readonly<{ changeId: string; agreementId: number; signer: string; parties: readonly [string, string] }>
export type HandshakeResident = Readonly<{ id: number; handle: string; placeId: number | null; x: number; y: number;
  destinationId?: number | null; visible: boolean; walking: boolean; busy: boolean }>
export type HandshakePlan = Readonly<{ signature: AgreementSignature; leftId: number; rightId: number; placeId: number;
  leftStart: Point; rightStart: Point; leftTarget: Point; rightTarget: Point; startedAt: number }>
export type HandshakeFrame = Readonly<{ left: Point; right: Point; hands: boolean; shake: number; agreementId: number }>
export type StartedHandshake = Readonly<{ plan: HandshakePlan; speed: number }>

const DURATION_MS = 1_800
const FLOOR_MS = 700
const HAND_CELL_VALUES: Array<{ x: number; y: number }> = [
  { x: -3, y: 0 }, { x: -2, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 },
]
export const HAND_PIXELS: readonly Readonly<{ x: number; y: number }>[] = Object.freeze(HAND_CELL_VALUES.map(cell => Object.freeze(cell)))

export function agreementSignature(event: ReplayEvent, pairs: ReadonlyMap<string, AgreementPair>): AgreementSignature | null {
  const actor = typeof event.actor === 'string' ? event.actor.trim() : ''
  const id = event.detail.agreement_id
  const pair = pairs.get(event.change_id)
  if (event.kind !== 'agreement_sign' || !actor || typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1
    || !pair || pair.agreementId !== id || !pair.parties.includes(actor)) return null
  return Object.freeze({ changeId: event.change_id, agreementId: id, signer: actor, parties: pair.parties })
}

export function handshakeDuration(speed: number = BASE_SPEED): number {
  return Math.max(FLOOR_MS, DURATION_MS * holdScale(speed))
}

export function planHandshake(signature: AgreementSignature, residents: Readonly<Record<number, HandshakeResident>>,
  layout: NestedLayout, reservations: ThingReservations, startedAt = 0): HandshakePlan | null {
  const people = signature.parties.map(handle => Object.values(residents).find(row => row.handle.trim() === handle))
  const [first, second] = people
  if (!first || !second || first.id === second.id || first.placeId === null || first.placeId !== second.placeId
    || !eligible(first) || !eligible(second)) return null
  const room = layout.rooms[first.placeId]
  if (!room || hiddenRoom(layout, room.id)) return null
  if (Object.values(residents).some(row => row.id !== first.id && row.id !== second.id && row.walking
    && (row.placeId === room.id || row.destinationId === room.id))) return null
  const dx = second.x - first.x; const dy = second.y - first.y; const distance = Math.hypot(dx, dy)
  if (!Number.isFinite(distance) || distance < 36) return null
  const ux = dx / distance; const uy = dy / distance; const middle = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
  const half = 16 / Math.max(Math.abs(ux), Math.abs(uy))
  const leftTarget = Object.freeze({ x: Math.floor(middle.x - ux * half), y: Math.floor(middle.y - uy * half) })
  const rightTarget = Object.freeze({ x: Math.ceil(middle.x + ux * half), y: Math.ceil(middle.y + uy * half) })
  if (Math.max(Math.abs(leftTarget.x - rightTarget.x), Math.abs(leftTarget.y - rightTarget.y)) < 32) return null
  const obstacles = [
    ...Object.values(residents).filter(row => row.id !== first.id && row.id !== second.id && row.placeId === room.id)
      .map(row => ({ x: row.x, y: row.y, clearance: 32 })),
    ...(reservations[room.id] ?? []).map(spot => ({ x: spot.x + 16, y: spot.y + 16, clearance: 48 })),
  ]
  const walls = Object.values(layout.rooms).filter(row => row.id !== room.id && insideRoomTree(layout, row.id, room.id))
  if (!safeSegment(first, leftTarget, room.standing, obstacles, walls) || !safeSegment(second, rightTarget, room.standing, obstacles, walls)) return null
  return Object.freeze({ signature, leftId: first.id, rightId: second.id, placeId: room.id,
    leftStart: Object.freeze({ x: first.x, y: first.y }), rightStart: Object.freeze({ x: second.x, y: second.y }),
    leftTarget, rightTarget, startedAt })
}

export function handshakeFrame(plan: HandshakePlan, now: number, speed = BASE_SPEED): HandshakeFrame | null {
  if (!Number.isFinite(now) || now < plan.startedAt) return null
  const duration = handshakeDuration(speed); const progress = (now - plan.startedAt) / duration
  if (progress >= 1) return null
  const meeting = progress < 0.3 ? progress / 0.3 : progress <= 0.7 ? 1 : (1 - progress) / 0.3
  const point = (from: Point, to: Point): Point => Object.freeze({ x: Math.round(from.x + (to.x - from.x) * meeting), y: Math.round(from.y + (to.y - from.y) * meeting) })
  return Object.freeze({ left: point(plan.leftStart, plan.leftTarget), right: point(plan.rightStart, plan.rightTarget),
    hands: progress >= 0.3 && progress <= 0.7, shake: progress >= 0.3 && progress <= 0.7 ? Math.round(progress * 12) % 2 : 0,
    agreementId: plan.signature.agreementId })
}

export async function readAgreementPairs(events: readonly ReplayEvent[], read: (event: ReplayEvent) => Promise<AgreementPair | null>,
  current: ReadonlyMap<string, AgreementPair> = new Map()): Promise<{ pairs: ReadonlyMap<string, AgreementPair>; failed: boolean }> {
  const pairs = new Map(current); let failed = false
  const signatures = events.filter(event => event.kind === 'agreement_sign' && !pairs.has(event.change_id))
  for (let offset = 0; offset < signatures.length; offset += 4) {
    await Promise.all(signatures.slice(offset, offset + 4).map(async event => {
      try { const pair = await read(event); if (pair) pairs.set(event.change_id, pair) } catch { failed = true }
    }))
  }
  return Object.freeze({ pairs, failed })
}

function eligible(row: HandshakeResident): boolean { return row.visible && !row.walking && !row.busy && Number.isFinite(row.x) && Number.isFinite(row.y) }
function safeSegment(from: Point, to: Point, bounds: { x: number; y: number; width: number; height: number },
  obstacles: readonly (Point & { clearance: number })[], walls: readonly { x: number; y: number; width: number; height: number }[]): boolean {
  if ([from, to].some(point => point.x < bounds.x + 16 || point.x > bounds.x + bounds.width - 16
    || point.y < bounds.y + 16 || point.y > bounds.y + bounds.height - 16)) return false
  if (obstacles.some(point => segmentHitsBox(from, to, point.x - point.clearance, point.y - point.clearance,
    point.x + point.clearance, point.y + point.clearance))) return false
  return !walls.some(wall => segmentHitsBox(from, to, wall.x - 16, wall.y - 16, wall.x + wall.width + 16, wall.y + wall.height + 16))
}
function segmentHitsBox(from: Point, to: Point, left: number, top: number, right: number, bottom: number): boolean {
  let low = 0; let high = 1
  for (const [start, delta, min, max] of [[from.x, to.x - from.x, left, right], [from.y, to.y - from.y, top, bottom]] as const) {
    if (delta === 0) { if (start >= min && start <= max) continue; return false }
    const a = (min - start) / delta; const b = (max - start) / delta
    low = Math.max(low, Math.min(a, b)); high = Math.min(high, Math.max(a, b)); if (low > high) return false
  }
  return true
}
function insideRoomTree(layout: NestedLayout, id: number, ancestor: number): boolean {
  let room = layout.rooms[id]; const seen = new Set<number>()
  while (room && !seen.has(room.id)) { if (room.parentId === ancestor) return true; seen.add(room.id); room = room.parentId === null ? undefined : layout.rooms[room.parentId] }
  return false
}
function hiddenRoom(layout: NestedLayout, id: number): boolean {
  let room = layout.rooms[id]; const seen = new Set<number>()
  while (room) { if (room.quiet || seen.has(room.id)) return true; seen.add(room.id); room = room.parentId === null ? undefined : layout.rooms[room.parentId] }
  return false
}
