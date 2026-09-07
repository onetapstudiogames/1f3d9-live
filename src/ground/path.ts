import { ROOM_GAP, ROOM_PADDING, type NestedLayout, type Point, type Room } from './nested.ts'

const finitePoint = (point: Point): boolean => Number.isFinite(point.x) && Number.isFinite(point.y)

function append(points: Point[], point: Point): void {
  const previous = points.at(-1)
  if (!previous || previous.x !== point.x || previous.y !== point.y) points.push(Object.freeze({ ...point }))
}

const leftAisle = (room: Room): number => room.x + ROOM_PADDING / 2

// The inset perimeter is clear of children and connects every door to the left aisle.
function doorToOwnAisle(room: Room): readonly Point[] {
  const { door } = room
  const left = leftAisle(room)
  const top = room.y + ROOM_PADDING / 2
  const right = room.x + room.width - ROOM_PADDING / 2
  const bottom = room.y + room.height - ROOM_PADDING / 2
  if (door.x === room.x) return [door, { x: left, y: door.y }]
  if (door.x === room.x + room.width) return [door, { x: right, y: door.y }, { x: right, y: top }, { x: left, y: top }]
  const laneY = door.y === room.y ? top : bottom
  return [door, { x: door.x, y: laneY }, { x: left, y: laneY }]
}

function childDoorToParentAisle(layout: NestedLayout, parent: Room, child: Room): readonly Point[] {
  const { door } = child
  const bottom = child.y + child.height
  if (door.y === child.y) {
    // Shelves align at the bottom. A short room must clear its taller neighbours first.
    const rowTop = Math.min(...parent.children.map(id => layout.rooms[id]!)
      .filter(sibling => sibling.y + sibling.height === bottom).map(sibling => sibling.y))
    const laneY = rowTop - ROOM_GAP / 2
    return [door, { x: door.x, y: laneY }, { x: leftAisle(parent), y: laneY }]
  }
  const laneY = bottom + ROOM_GAP / 2
  if (door.y === bottom) return [door, { x: door.x, y: laneY }, { x: leftAisle(parent), y: laneY }]
  const outsideX = door.x + (door.x === child.x ? -ROOM_GAP / 2 : ROOM_GAP / 2)
  return [door, { x: outsideX, y: door.y }, { x: outsideX, y: laneY }, { x: leftAisle(parent), y: laneY }]
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
  append(points, { x: leftAisle(from), y: start.y })

  if (from.id !== lca.id) {
    let current = from
    while (current.id !== lca.id) {
      for (const point of [...doorToOwnAisle(current)].reverse()) append(points, point)
      const parent = layout.rooms[current.parentId!]!
      for (const point of childDoorToParentAisle(layout, parent, current)) append(points, point)
      current = parent
    }
  }

  const descent = toChain.slice(0, toChain.findIndex(room => room.id === lca.id)).reverse()
  let parent = lca
  for (const child of descent) {
    for (const point of [...childDoorToParentAisle(layout, parent, child)].reverse()) append(points, point)
    for (const point of doorToOwnAisle(child)) append(points, point)
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
