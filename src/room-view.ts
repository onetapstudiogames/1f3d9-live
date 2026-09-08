import type { ReplayPlace, Resident } from './city/types.ts'
import type { NestedLayout, Point, Room } from './ground/nested.ts'

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

// The initial room is a presentation choice based only on current, public census facts.
export function busiestRoom(places: readonly ReplayPlace[], census: readonly Resident[]): number | null {
  const publicIds = publicPlaceIds(places)
  const counts = new Map<number, number>()
  for (const resident of census) {
    const id = resident.current_place_id
    if (id !== null && publicIds.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...publicIds].sort((left, right) =>
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

export function singleRoomLayout(source: Room, width: number, height: number): NestedLayout {
  if (![width, height].every(Number.isFinite) || width < 128 || height < 220) {
    throw new RangeError('A single room needs a finite viewport at least 128 by 220 pixels')
  }
  const roomWidth = width - 16
  const roomHeight = height - 16
  const x = 8; const y = 8
  const standing = Object.freeze({ x: x + 48, y: y + 100, width: roomWidth - 96, height: roomHeight - 170 })
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
