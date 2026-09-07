import type { ReplayEvent } from './city/types.ts'
import type { NestedLayout, Point } from './ground/nested.ts'
import { BASE_SPEED, holdScale } from './replay/index.ts'

export type Transfer = Readonly<{ thingId: number; actor: string; partnerId: number; placeId: number }>
export type CarriedMove = Readonly<{
  thingId: number
  actor: string
  carrierId: number
  actionId: number
  fromId: number
  toId: number
}>
export type FloatFrame = Readonly<{ x: number; y: number; heartX: number; heartY: number; alpha: number }>
export type TransferResident = Readonly<{
  id: number
  handle: string
  placeId: number | null
  x: number
  y: number
  visible: boolean
  walking: boolean
}>
export type TransferPartners = Readonly<{ from: Point; to: Point }>

export const HEART_CELLS: readonly (readonly [number, number])[] = Object.freeze([
  [0, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [1, 3],
].map(cell => Object.freeze(cell) as readonly [number, number]))
export const HEART_PIXELS: readonly Readonly<{ x: number; y: number }>[] = Object.freeze(
  HEART_CELLS.map(([x, y]) => Object.freeze({ x, y })),
)

const FLOAT_DURATION_MS = 1_200
const FLOAT_FLOOR_MS = 400

export function transferFor(row: ReplayEvent): Transfer | null {
  if (row.kind !== 'transfer') return null
  const actor = cleanActor(row.actor)
  if (!actor) return null
  const detail = row.detail
  const thingId = detail.mode === 'gift' && detail.asset_type === 'thing'
    ? detail.asset_id
    : detail.mode === 'effect' && detail.type === 'thing' ? detail.id : null
  if (!positiveId(thingId) || !positiveId(detail.resident_id) || !positiveId(detail.place_id)) return null
  return { thingId, actor, partnerId: detail.resident_id, placeId: detail.place_id }
}

// The verified public transfer rows contain only gift and effect modes. Price, names,
// and asset ids do not establish a sale, so sale presentation stays unavailable.
export function saleFor(_row: ReplayEvent): null {
  return null
}

export function carriedMove(action: ReplayEvent, notice: ReplayEvent): CarriedMove | null {
  const actor = cleanActor(action.actor)
  if (
    !actor || action.kind !== 'action' || action.detail.action !== 'move' ||
    action.detail.status !== 'applied' || action.detail.mode !== 'carry' || hasError(action.detail) ||
    notice.kind !== 'thing_moved' || notice.detail.mode !== 'carry' || hasError(notice.detail)
  ) return null
  if (!Number.isFinite(Date.parse(action.at)) || !Number.isFinite(Date.parse(notice.at))) return null
  const a = action.detail
  const n = notice.detail
  if (
    !positiveId(a.thing_id) || !positiveId(a.action_id) || !positiveId(a.from_place_id) || !positiveId(a.to_place_id) ||
    !positiveId(n.thing_id) || !positiveId(n.action_id) || !positiveId(n.resident_id) ||
    !positiveId(n.from_place_id) || !positiveId(n.place_id) ||
    a.thing_id !== n.thing_id || a.action_id !== n.action_id || a.from_place_id !== n.from_place_id || a.to_place_id !== n.place_id ||
    cleanActor(notice.actor) !== actor
  ) return null
  return { thingId: a.thing_id, actor, carrierId: n.resident_id, actionId: a.action_id, fromId: a.from_place_id, toId: a.to_place_id }
}

export function transferDuration(speed: number = BASE_SPEED): number {
  return Math.max(FLOAT_FLOOR_MS, FLOAT_DURATION_MS * holdScale(speed))
}

export function floatFrame(from: Point, to: Point, startedAt: number, nowMs: number, speed: number = BASE_SPEED): FloatFrame | null {
  if (![from.x, from.y, to.x, to.y, startedAt, nowMs].every(Number.isFinite) || nowMs < startedAt) return null
  const duration = transferDuration(speed)
  const elapsed = nowMs - startedAt
  if (elapsed >= duration) return null
  const progress = elapsed / duration
  const x = from.x + (to.x - from.x) * progress
  const y = from.y + (to.y - from.y) * progress - Math.sin(Math.PI * progress) * 32
  const alpha = Math.max(0, Math.min(1, (1 - progress) / 0.25))
  return { x: Math.round(x), y: Math.round(y), heartX: Math.round(x), heartY: Math.round(y - 12), alpha }
}

export function transferPartners(
  transfer: Transfer,
  residents: Readonly<Record<number, TransferResident>>,
  layout: NestedLayout,
): TransferPartners | null {
  if (!placeIsVisible(layout, transfer.placeId)) return null
  const giver = Object.values(residents).find(resident => resident.handle.trim() === transfer.actor)
  const receiver = residents[transfer.partnerId]
  if (!eligible(giver, transfer.placeId) || !eligible(receiver, transfer.placeId)) return null
  return { from: { x: giver.x, y: giver.y }, to: { x: receiver.x, y: receiver.y } }
}

function eligible(resident: TransferResident | undefined, placeId: number): resident is TransferResident {
  return resident !== undefined && resident.placeId === placeId && resident.visible && !resident.walking &&
    Number.isFinite(resident.x) && Number.isFinite(resident.y)
}

function placeIsVisible(layout: NestedLayout, placeId: number): boolean {
  let room = layout.rooms[placeId]
  const seen = new Set<number>()
  while (room) {
    if (seen.has(room.id) || room.quiet) return false
    seen.add(room.id)
    room = room.parentId === null ? undefined : layout.rooms[room.parentId]
  }
  return seen.has(placeId)
}

function cleanActor(actor: string | null): string | null {
  if (typeof actor !== 'string') return null
  const clean = actor.trim()
  return clean.length > 0 ? clean : null
}

function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function hasError(detail: Readonly<Record<string, unknown>>): boolean {
  return 'error' in detail && detail.error !== null && detail.error !== undefined
}
