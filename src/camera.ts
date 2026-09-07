import type { NestedLayout, Room } from './ground/nested.ts'

export function roomsInCamera(layout: NestedLayout, view: Readonly<{ x: number; y: number; width: number; height: number }>, zoom: number): readonly Room[] {
  if (!Number.isFinite(zoom) || zoom < 0.25 || view.width > 2200 || view.height > 2200) return []
  const centerX = view.x + view.width / 2
  const centerY = view.y + view.height / 2
  return Object.values(layout.rooms).filter(room => !room.quiet
    && room.standing.x < view.x + view.width && room.standing.x + room.standing.width > view.x
    && room.standing.y < view.y + view.height && room.standing.y + room.standing.height > view.y)
    .sort((a, b) => Math.hypot(a.x + a.width / 2 - centerX, a.y + a.height / 2 - centerY)
      - Math.hypot(b.x + b.width / 2 - centerX, b.y + b.height / 2 - centerY) || a.id - b.id)
}

// A starting view is presentation, chosen from actual occupied rooms, never a census claim.
export function nearbyRooms(
  layout: NestedLayout,
  residents: readonly Readonly<{ placeId: number | null; visible: boolean }>[],
): readonly Room[] {
  const visible = residents.filter(resident => resident.visible && resident.placeId !== null)
  const candidates = visible.flatMap(resident => {
    const room = layout.rooms[resident.placeId!]
    if (!room) return []
    const parent = room.parentId === null ? undefined : layout.rooms[room.parentId]
    return [parent && parent.width <= 1800 && parent.height <= 1800 ? parent : room]
  })
  const unique = [...new Map(candidates.map(room => [room.id, room])).values()]
  const compact = unique.filter(room => room.width <= 1800 && room.height <= 1800)
  const choices = compact.length ? compact : unique
  const scores = new Map(choices.map(room => {
    const occupied = visible.filter(resident => {
      let current: Room | undefined = layout.rooms[resident.placeId!]
      while (current && current.id !== room.id) current = current.parentId === null ? undefined : layout.rooms[current.parentId]
      return current !== undefined
    }).length
    return [room.id, occupied / Math.sqrt(room.width * room.height) * (room.children.length ? 2 : 1)]
  }))
  return choices.sort((a, b) => scores.get(b.id)! - scores.get(a.id)! || a.id - b.id)
}
