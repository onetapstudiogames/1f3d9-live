import type { FocusTarget } from './viewer.ts'
import type { Simulation } from './replay/simulation.ts'
import type { ThingSimulation } from './things.ts'
import type { PlaceAnimation } from './place-animation.ts'
import type { NestedLayout } from './ground/nested.ts'

export function currentFocusTargets(residents: Simulation['residents'], things: ThingSimulation['things'],
  animations: readonly PlaceAnimation[], layout: NestedLayout, canDraw: (resident: Simulation['residents'][number]) => boolean,
  hidden: ReadonlySet<number>, hiddenPlaces: ReadonlySet<number>, activity: readonly Readonly<{ id: number; startedAt: number }>[] = []): readonly FocusTarget[] {
  const candidates: FocusTarget[] = []
  for (const { id, startedAt } of activity) {
    const row = residents[id]
    if (row && row.placeId !== null && canDraw(row)) candidates.push({ key: `activity:${id}`, x: row.x, y: row.y,
      roomId: row.placeId, rank: 3, startedAt })
  }
  for (const row of Object.values(residents)) {
    if (!canDraw(row) || row.placeId === null) continue
    const rank = row.bubble ? 6 : row.agreementUntil || row.transferUntil ? 5
      : row.inventionUntil || row.showingNotice ? 4 : row.blockedAttempt ? 3 : row.walking ? 1 : 0
    if (rank) candidates.push({ key: `resident:${row.id}`, x: row.x, y: row.y, roomId: row.placeId,
      rank, startedAt: row.bubble?.startedAt ?? 0 })
  }
  for (const thing of Object.values(things)) if (thing.visible && thing.effect && !hidden.has(thing.placeId)) candidates.push({
    key: `thing:${thing.id}`, x: thing.x, y: thing.y, roomId: thing.placeId, rank: 5, startedAt: thing.effect.startedAt })
  for (const animation of animations) {
    const room = layout.rooms[animation.placeId]
    if (room && animation.kind === 'founding' && !hiddenPlaces.has(room.id)
      && (room.parentId === null || !hidden.has(room.parentId))) candidates.push({
        key: `place:${room.id}`, x: room.door.x, y: room.door.y, roomId: room.id, rank: 4, startedAt: animation.startedAt })
  }
  return Object.freeze(candidates)
}
