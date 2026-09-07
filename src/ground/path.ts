import { ROOM_GAP, ROOM_PADDING, type NestedLayout, type Point, type Room } from './nested.ts'

const finitePoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y)

function append(points: Point[], point: Point): void {
  const previous = points.at(-1)
  if (!previous || previous.x !== point.x || previous.y !== point.y) points.push(Object.freeze({ ...point }))
}

const leftAisle = (room: Room): number => room.x + ROOM_PADDING / 2
const bottomLane = (room: Room): number => room.y + room.height - ROOM_PADDING / 2

function toOwnDoor(points: Point[], room: Room): void {
  const current = points.at(-1)!
  append(points, { x: leftAisle(room), y: current.y })
  append(points, { x: leftAisle(room), y: bottomLane(room) })
  append(points, { x: room.door.x, y: bottomLane(room) })
  append(points, room.door)
}

function childDoorToParentAisle(points: Point[], parent: Room, child: Room): void {
  const laneY = child.door.y + ROOM_GAP / 2
  append(points, { x: child.door.x, y: laneY })
  append(points, { x: leftAisle(parent), y: laneY })
}

function parentAisleToChildDoor(points: Point[], parent: Room, child: Room): void {
  const laneY = child.door.y + ROOM_GAP / 2
  append(points, { x: leftAisle(parent), y: laneY })
  append(points, { x: child.door.x, y: laneY })
  append(points, child.door)
}

function doorToOwnAisle(points: Point[], room: Room): void {
  append(points, { x: room.door.x, y: bottomLane(room) })
  append(points, { x: leftAisle(room), y: bottomLane(room) })
}

export function walkPath(layout: NestedLayout, fromId: number, toId: number, start: Point, end: Point): readonly Point[] {
  const from = layout.rooms[fromId]
  const to = layout.rooms[toId]
  if (!from || !to || !finitePoint(start) || !finitePoint(end)) return Object.freeze([])
  if (fromId === toId) return Object.freeze([
    Object.freeze({ ...start }),
    Object.freeze({ x: end.x, y: start.y }),
    Object.freeze({ ...end }),
  ])
  const ancestors = (room: Room): Room[] => {
    const result: Room[] = []
    let current: Room | undefined = room
    while (current) {
      result.push(current)
      current = current.parentId === null ? undefined : layout.rooms[current.parentId]
    }
    return result
  }
  const fromChain = ancestors(from)
  const toChain = ancestors(to)
  const toSet = new Set(toChain.map(room => room.id))
  const lca = fromChain.find(room => toSet.has(room.id))!
  const points: Point[] = [Object.freeze({ ...start })]

  if (from.id === lca.id) append(points, { x: leftAisle(lca), y: start.y })
  else {
    let current = from
    while (current.id !== lca.id) {
      toOwnDoor(points, current)
      const parent = layout.rooms[current.parentId!]!
      childDoorToParentAisle(points, parent, current)
      current = parent
    }
  }

  const descent = toChain.slice(0, toChain.findIndex(room => room.id === lca.id)).reverse()
  let parent = lca
  for (const child of descent) {
    parentAisleToChildDoor(points, parent, child)
    doorToOwnAisle(points, child)
    parent = child
  }
  append(points, { x: leftAisle(to), y: end.y })
  append(points, end)
  return Object.freeze(points)
}

export function pointAlongPath(path: readonly Point[], progress: number): Readonly<Point & { flipX: boolean; done: boolean }> {
  if (!path.length) return Object.freeze({ x: 0, y: 0, flipX: false, done: true })
  const safeProgress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
  const lengths = path.slice(1).map((point, index) => Math.hypot(point.x - path[index]!.x, point.y - path[index]!.y))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  if (total === 0) return Object.freeze({ ...path.at(-1)!, flipX: false, done: safeProgress >= 1 })
  let remaining = total * safeProgress
  let flipX = false
  for (let index = 0; index < lengths.length; index += 1) {
    const from = path[index]!
    const to = path[index + 1]!
    const length = lengths[index]!
    if (to.x !== from.x && (remaining > 0 || safeProgress > 0)) flipX = to.x < from.x
    if (remaining <= length || index === lengths.length - 1) {
      const ratio = length === 0 ? 1 : remaining / length
      return Object.freeze({ x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio, flipX, done: safeProgress >= 1 })
    }
    remaining -= length
  }
  return Object.freeze({ ...path.at(-1)!, flipX, done: true })
}
