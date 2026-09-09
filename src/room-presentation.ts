import type { NestedLayout, Point } from './ground/nested.ts'
import { allocateRoomCrowdingFrame, type RoomCrowdingEntry, type RoomCrowdingPlacement,
  type RoomCrowdingState, type RoomCrowdingRect, type RoomCrowdingRoute } from './room-crowding.ts'
import { projectRoomPoint, roomIsPublic } from './room-view.ts'

type Entity = Readonly<{ id: number; placeId: number | null; x: number; y: number; visible: boolean }>
type Figure = Entity & Readonly<{ walking?: boolean; bubble?: unknown; inventionUntil?: number | null;
  agreementUntil?: number | null; transferUntil?: number | null }>
export type RoomPlacements = Readonly<Record<string, RoomCrowdingPlacement>>
export type RoomScreenPose = Readonly<Point & { placeId: number; visible: boolean; moving: boolean; flipX?: boolean }>
export type RoomPresentationMotion = Readonly<{
  poses: ReadonlyMap<number, RoomScreenPose>; reservations: readonly RoomCrowdingRect[]; routes?: readonly RoomCrowdingRoute[]
}>

export function roomFigurePriority(row: Figure, following: number | null): number {
  const followed = row.id === following
  if (row.bubble) return followed ? 120 : 110
  if (row.walking) return followed ? 100 : 80
  if (row.inventionUntil || row.agreementUntil || row.transferUntil) return followed ? 90 : 60
  if (followed) return 70
  return 10
}

// All visual layers consume these copies; simulation positions remain in the recorded room layout.
export function presentRoom<R extends Figure, T extends Entity>(residents: Readonly<Record<number, R>>,
  things: Readonly<Record<number, T>>, source: NestedLayout | undefined, target: NestedLayout | undefined,
  hidden: ReadonlySet<number>, previous: RoomPlacements | RoomCrowdingState = {}, following: number | null = null,
  agreements: ReadonlyMap<number, Point> = new Map(), motion?: RoomPresentationMotion,
  sleepers: ReadonlySet<number> = new Set()): Readonly<{
    residents: Readonly<Record<number, R>>; things: Readonly<Record<number, T>>; placements: RoomPlacements
    crowding: RoomCrowdingState; hiddenSpeakerIds: readonly number[]
  }> {
  const project = <E extends Entity>(row: E, point: Point = row): E => {
    const id = row.placeId
    const from = id === null ? undefined : source?.rooms[id]
    const to = id === null ? undefined : target?.rooms[id]
    const position = row.visible && from && to && !hidden.has(id!) && roomIsPublic(source!, id!)
      ? projectRoomPoint(point, from, to) : null
    return Object.freeze(position ? { ...row, ...position } : { ...row, visible: false })
  }
  const figures = Object.values(residents).map(row => {
    if (sleepers.has(row.id)) return Object.freeze({ ...row, visible: false })
    const projected = project(row, agreements.get(row.id) ?? row)
    const pose = motion?.poses.get(row.id)
    if (!pose || agreements.has(row.id) || row.placeId !== pose.placeId || !target?.rooms[pose.placeId]
      || hidden.has(pose.placeId) || !source || !roomIsPublic(source, pose.placeId)) return projected
    // A previously unseated speaker can claim a seat ahead of idle figures.
    if (!pose.visible && row.bubble) return { ...projected, visible: true }
    return Object.freeze({ ...row, x: pose.x, y: pose.y, visible: pose.visible,
      walking: Boolean(row.walking || pose.moving), ...(pose.flipX === undefined ? {} : { flipX: pose.flipX }) })
  })
  const objects = Object.values(things).map(row => project(row))
  const entries: readonly RoomCrowdingEntry[] = [
    ...figures.filter(row => row.visible && !motion?.poses.get(row.id)?.moving).map(row => ({ id: `resident:${row.id}`, kind: 'resident' as const,
      preferred: row, priority: roomFigurePriority(row, following) })),
    ...objects.filter(row => row.visible).map(row => ({ id: `thing:${row.id}`, kind: 'thing' as const,
      preferred: row, priority: 0 })),
  ]
  const room = target?.rooms[target.rootId]
  const crowding: RoomCrowdingState = room ? allocateRoomCrowdingFrame(entries, room.standing, previous, motion?.reservations, motion?.routes) :
    Object.freeze({ bandKey: 'no-room', key: 'no-room', grid: Object.freeze([]), placements: Object.freeze({}),
      metrics: Object.freeze({ gridBuilds: 0, candidateChecks: 0 }) })
  const placements = crowding.placements
  const placed = <E extends Entity>(rows: readonly E[], kind: 'resident' | 'thing'): Readonly<Record<number, E>> =>
    Object.freeze(Object.fromEntries(rows.map(row => {
      if (kind === 'resident' && row.visible && motion?.poses.get(row.id)?.moving) return [row.id, row]
      const spot = placements[`${kind}:${row.id}`]
      return [row.id, Object.freeze(spot?.visible ? { ...row, x: spot.x, y: spot.y } : { ...row, visible: false })]
    })))
  const hiddenSpeakerIds = Object.freeze(figures.filter(row => row.visible && row.bubble && !motion?.poses.get(row.id)?.moving &&
    !placements[`resident:${row.id}`]?.visible).map(row => row.id).sort((left, right) => left - right))
  return Object.freeze({ residents: placed(figures, 'resident'), things: placed(objects, 'thing'), placements,
    crowding, hiddenSpeakerIds })
}
