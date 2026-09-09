import type { ReplayEvent } from './city/types.ts'
import type { NestedLayout, Point } from './ground/nested.ts'

export type TransferMode = 'gift' | 'effect'
export type Transfer = Readonly<{ thingId: number; actor: string; mode: TransferMode; partnerId: number; placeId: number }>
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

// The heart belongs to a gift and to nothing else; an effect-mode transfer draws the plain
// icon glide with no heart, because the record says a thing's effect moved the ownership.
export const HEART_CELLS: readonly (readonly [number, number])[] = Object.freeze([
  [0, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [2, 1], [3, 1], [0, 2], [1, 2], [2, 2], [1, 3],
].map(cell => Object.freeze(cell) as readonly [number, number]))
export const HEART_PIXELS: readonly Readonly<{ x: number; y: number }>[] = Object.freeze(
  HEART_CELLS.map(([x, y]) => Object.freeze({ x, y })),
)

const FLOAT_DURATION_MS = 2_400

// The city publishes only two transfer modes, and no sale marker at all: a thing sold on
// the market arrives here as an ordinary transfer row, so nothing below may call one a sale.
// City issue onetapstudiogames/1f3d9#281 asks for a public sale fact.
// `gift` is one resident handing a thing to another; `effect` is a thing's own effect moving
// ownership, and its actor is the resident whose use set that effect off, not a giver.
export function transferFor(row: ReplayEvent): Transfer | null {
  if (row.kind !== 'transfer') return null
  const actor = cleanActor(row.actor)
  if (!actor) return null
  const detail = row.detail
  const mode: TransferMode | null = detail.mode === 'gift' ? 'gift' : detail.mode === 'effect' ? 'effect' : null
  if (mode === null) return null
  const thingId = mode === 'gift' && detail.asset_type === 'thing'
    ? detail.asset_id
    : mode === 'effect' && detail.type === 'thing' ? detail.id : null
  if (!positiveId(thingId) || !positiveId(detail.resident_id) || !positiveId(detail.place_id)) return null
  return { thingId, actor, mode, partnerId: detail.resident_id, placeId: detail.place_id }
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

export function transferDuration(): number {
  return FLOAT_DURATION_MS
}

export function floatFrame(from: Point, to: Point, startedAt: number, nowMs: number): FloatFrame | null {
  if (![from.x, from.y, to.x, to.y, startedAt, nowMs].every(Number.isFinite) || nowMs < startedAt) return null
  const duration = transferDuration()
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
  // `actor` is the resident the thing leaves, whether it was handed over or an effect took it.
  const leaves = Object.values(residents).find(resident => resident.handle.trim() === transfer.actor)
  const receives = residents[transfer.partnerId]
  if (!eligible(leaves, transfer.placeId) || !eligible(receives, transfer.placeId)) return null
  return { from: { x: leaves.x, y: leaves.y }, to: { x: receives.x, y: receives.y } }
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
