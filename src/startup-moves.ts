import type { ReplayEvent } from './city/types.ts'

export type StartupCensusResident = Readonly<{
  handle: string | null
  current_place_id: number | null
}>

function isAppliedRecordedMove(event: ReplayEvent): boolean {
  const detail = event.detail
  return event.kind === 'action' &&
    (detail.action === 'move' || detail.action === 'go_home') &&
    detail.status === 'applied' &&
    detail.error == null &&
    positivePlaceId(detail.from_place_id) &&
    positivePlaceId(detail.to_place_id)
}

export function startupMoveSuppressions(
  events: readonly ReplayEvent[],
  residents: readonly StartupCensusResident[],
): ReadonlySet<string> {
  const censusPlaces = new Map<string, number>()
  for (const resident of residents) {
    const handle = typeof resident.handle === 'string' ? resident.handle.trim() : ''
    if (handle.length > 0 && positivePlaceId(resident.current_place_id)) {
      censusPlaces.set(handle, resident.current_place_id)
    }
  }

  const movesByActor = new Map<string, ReplayEvent[]>()
  for (const event of events) {
    const actor = typeof event.actor === 'string' ? event.actor.trim() : ''
    if (!isAppliedRecordedMove(event) || actor.length === 0 || !censusPlaces.has(actor)) continue
    movesByActor.set(actor, [...(movesByActor.get(actor) ?? []), event])
  }

  const suppressed = new Set<string>()
  for (const [actor, unorderedMoves] of movesByActor) {
    const moves = [...unorderedMoves].sort((left, right) => compareChangeIds(left.change_id, right.change_id))
    const censusPlace = censusPlaces.get(actor)
    let lastMatchingMove = -1
    for (let index = 0; index < moves.length; index += 1) {
      if (moves[index]!.detail.to_place_id === censusPlace) lastMatchingMove = index
    }
    for (let index = 0; index <= lastMatchingMove; index += 1) suppressed.add(moves[index]!.change_id)
  }
  return suppressed
}

function compareChangeIds(left: string, right: string): number {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftId = BigInt(left)
    const rightId = BigInt(right)
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
  }
  return left.localeCompare(right)
}

function positivePlaceId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
