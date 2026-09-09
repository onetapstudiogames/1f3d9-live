import type { ReplayEvent } from '../city/types.ts'

export type AppliedMove = Readonly<{ fromId: number; toId: number }>


export function appliedMove(event: ReplayEvent): AppliedMove | null {
  const { action, status, from_place_id: fromId, to_place_id: toId } = event.detail
  if (event.kind !== 'action' || (action !== 'move' && action !== 'go_home') || status !== 'applied') {
    return null
  }
  if (!isPlaceId(fromId) || !isPlaceId(toId) || fromId === toId) return null

  return { fromId, toId }
}

function isPlaceId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}
