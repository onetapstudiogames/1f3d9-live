import type { NestedLayout, Point } from './ground/nested.ts'
import { allocateRoomCrowding, type RoomCrowdingEntry, type RoomCrowdingPlacement } from './room-crowding.ts'
import { projectRoomPoint, roomIsPublic } from './room-view.ts'

type Entity = Readonly<{ id: number; placeId: number | null; x: number; y: number; visible: boolean }>
type Figure = Entity & Readonly<{ walking?: boolean; bubble?: unknown; inventionUntil?: number | null;
  agreementUntil?: number | null; transferUntil?: number | null }>
export type RoomPlacements = Readonly<Record<string, RoomCrowdingPlacement>>

export function roomFigurePriority(row: Figure, following: number | null): number {
  if (row.id === following) return 100
  if (row.bubble) return 80
  if (row.walking) return 60
  if (row.inventionUntil || row.agreementUntil || row.transferUntil) return 40
  return 10
}

// All visual layers consume these copies; simulation positions remain in the recorded room layout.
export function presentRoom<R extends Figure, T extends Entity>(residents: Readonly<Record<number, R>>,
  things: Readonly<Record<number, T>>, source: NestedLayout | undefined, target: NestedLayout | undefined,
  hidden: ReadonlySet<number>, previous: RoomPlacements = {}, following: number | null = null,
  agreements: ReadonlyMap<number, Point> = new Map()): Readonly<{
    residents: Readonly<Record<number, R>>; things: Readonly<Record<number, T>>; placements: RoomPlacements
  }> {
  const project = <E extends Entity>(row: E, point: Point = row): E => {
    const id = row.placeId
    const from = id === null ? undefined : source?.rooms[id]
    const to = id === null ? undefined : target?.rooms[id]
    const position = row.visible && from && to && !hidden.has(id!) && roomIsPublic(source!, id!)
      ? projectRoomPoint(point, from, to) : null
    return Object.freeze(position ? { ...row, ...position } : { ...row, visible: false })
  }
  const figures = Object.values(residents).map(row => project(row, agreements.get(row.id) ?? row))
  const objects = Object.values(things).map(row => project(row))
  const entries: readonly RoomCrowdingEntry[] = [
    ...figures.filter(row => row.visible).map(row => ({ id: `resident:${row.id}`, kind: 'resident' as const,
      preferred: row, priority: roomFigurePriority(row, following) })),
    ...objects.filter(row => row.visible).map(row => ({ id: `thing:${row.id}`, kind: 'thing' as const,
      preferred: row, priority: 0 })),
  ]
  const room = target?.rooms[target.rootId]
  const placements: RoomPlacements = room ? allocateRoomCrowding(entries, room.standing, previous) : Object.freeze({})
  const placed = <E extends Entity>(rows: readonly E[], kind: 'resident' | 'thing'): Readonly<Record<number, E>> =>
    Object.freeze(Object.fromEntries(rows.map(row => {
      const spot = placements[`${kind}:${row.id}`]
      return [row.id, Object.freeze(spot?.visible ? { ...row, x: spot.x, y: spot.y } : { ...row, visible: false })]
    })))
  return Object.freeze({ residents: placed(figures, 'resident'), things: placed(objects, 'thing'), placements })
}
