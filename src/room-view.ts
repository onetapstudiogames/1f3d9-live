import type { ReplayPlace, Resident } from './city/types.ts'
import type { NestedLayout, Point, Room } from './ground/nested.ts'
import { ROOM_FIGURE_SIZE } from './room-crowding.ts'

function publicPlaceIds(places: readonly ReplayPlace[]): ReadonlySet<number> {
  const byId = new Map(places.map(place => [place.id, place]))
  const result = new Set<number>()
  for (const place of places) {
    const seen = new Set<number>()
    let current: ReplayPlace | undefined = place
    let isPublic = true
    while (current) {
      if (current.quiet || seen.has(current.id)) { isPublic = false; break }
      seen.add(current.id)
      if (current.parent_id === null) break
      current = byId.get(current.parent_id)
      if (!current) isPublic = false
    }
    if (isPublic) result.add(place.id)
  }
  return result
}

// The initial room is a presentation choice based only on residents standing there now.
export function busiestRoom(places: readonly ReplayPlace[], census: readonly Resident[]): number | null {
  const publicIds = publicPlaceIds(places)
  const parents = new Set(places.filter(place => publicIds.has(place.id)).map(place => place.parent_id)
    .filter((id): id is number => id !== null))
  const leafIds = new Set([...publicIds].filter(id => !parents.has(id)))
  const eligibleIds = leafIds.size > 0 ? leafIds : publicIds
  const counts = new Map<number, number>()
  for (const resident of census) {
    const id = resident.current_place_id
    if (!resident.asleep && id !== null && eligibleIds.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...eligibleIds].sort((left, right) =>
    (counts.get(right) ?? 0) - (counts.get(left) ?? 0) || left - right)[0] ?? null
}

export function roomIsPublic(layout: NestedLayout, id: number): boolean {
  const seen = new Set<number>()
  let current = layout.rooms[id]
  if (!current) return false
  while (current) {
    if (current.quiet || seen.has(current.id)) return false
    seen.add(current.id)
    if (current.parentId === null) return true
    current = layout.rooms[current.parentId]
    if (!current) return false
  }
  return false
}

function projectAxis(value: number, source: readonly [number, number, number, number],
  target: readonly [number, number, number, number]): number {
  const segment = value <= source[1] ? 0 : value <= source[2] ? 1 : 2
  const sourceSpan = source[segment + 1]! - source[segment]!
  if (sourceSpan === 0) return target[segment]!
  const progress = (value - source[segment]!) / sourceSpan
  return target[segment]! + progress * (target[segment + 1]! - target[segment]!)
}

const ROOM_OUTER_INSET = 8
const STANDING_HORIZONTAL_INSET = 48
const STANDING_TOP_INSET = 100
const STANDING_VERTICAL_RESERVE = 170
const MIN_ROOM_VIEW_WIDTH = ROOM_OUTER_INSET * 2 + STANDING_HORIZONTAL_INSET * 2 + ROOM_FIGURE_SIZE
const MIN_ROOM_VIEW_HEIGHT = ROOM_OUTER_INSET * 2 + STANDING_VERTICAL_RESERVE + ROOM_FIGURE_SIZE

export function roomViewportUsable(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) &&
    width >= MIN_ROOM_VIEW_WIDTH && height >= MIN_ROOM_VIEW_HEIGHT
}

export function singleRoomLayout(source: Room, width: number, height: number): NestedLayout {
  if (!roomViewportUsable(width, height)) {
    throw new RangeError(`A single room needs a finite viewport at least ${MIN_ROOM_VIEW_WIDTH} by ${MIN_ROOM_VIEW_HEIGHT} pixels`)
  }
  const roomWidth = width - ROOM_OUTER_INSET * 2
  const roomHeight = height - ROOM_OUTER_INSET * 2
  const x = ROOM_OUTER_INSET; const y = ROOM_OUTER_INSET
  const standing = Object.freeze({ x: x + STANDING_HORIZONTAL_INSET, y: y + STANDING_TOP_INSET,
    width: roomWidth - STANDING_HORIZONTAL_INSET * 2, height: roomHeight - STANDING_VERTICAL_RESERVE })
  const frame: Room = { ...source, parentId: null, depth: 0, x, y, width: roomWidth, height: roomHeight,
    door: Object.freeze({ x, y }), standing, children: Object.freeze([]), notch: null, shelf: null }
  const door = projectRoomPoint(source.door, source, frame)!
  const isolated: Room = Object.freeze({ ...frame, door })
  return Object.freeze({ rooms: Object.freeze({ [source.id]: isolated }), rootId: source.id, width, height })
}

export function projectRoomPoint(point: Point, source: Room, target: Room): Point | null {
  if (![point.x, point.y].every(Number.isFinite) || point.x < source.x || point.x > source.x + source.width ||
      point.y < source.y || point.y > source.y + source.height || source.standing.width <= 0 || source.standing.height <= 0) return null
  return Object.freeze({
    x: projectAxis(point.x,
      [source.x, source.standing.x, source.standing.x + source.standing.width, source.x + source.width],
      [target.x, target.standing.x, target.standing.x + target.standing.width, target.x + target.width]),
    y: projectAxis(point.y,
      [source.y, source.standing.y, source.standing.y + source.standing.height, source.y + source.height],
      [target.y, target.standing.y, target.standing.y + target.standing.height, target.y + target.height]),
  })
}
