import { ROOM_GAP, ROOM_PADDING, type NestedLayout, type Point, type Room } from './nested.ts'
import { roomContains } from './room-shape.ts'

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

function childDoorToParentAisle(parent: Room, child: Room): readonly Point[] {
  const { door } = child
  const bottom = child.y + child.height
  if (door.y === child.y) {
    const laneY = child.shelf?.laneAbove ?? child.y - ROOM_GAP / 2
    return [door, { x: door.x, y: laneY }, { x: leftAisle(parent), y: laneY }]
  }
  const laneY = child.shelf?.laneBelow ?? bottom + ROOM_GAP / 2
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
      for (const point of childDoorToParentAisle(parent, current)) append(points, point)
      current = parent
    }
  }

  const descent = toChain.slice(0, toChain.findIndex(room => room.id === lca.id)).reverse()
  let parent = lca
  for (const child of descent) {
    for (const point of [...childDoorToParentAisle(parent, child)].reverse()) append(points, point)
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

const SIDE_CLEARANCE = 32

// Add one small rectangular step around each standing centre that lies on a straight
// segment. A candidate is accepted only when all of its corners remain on the same
// floor as the blocked point, so a sidestep cannot cut through a room wall.
export function sidestepPath(
  layout: NestedLayout,
  path: readonly Point[],
  stationary: readonly Point[],
): readonly Point[] {
  if (path.length < 2 || !stationary.length) return Object.freeze([...path])
  const result: Point[] = [Object.freeze({ ...path[0]! })]
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1]!
    const to = path[index]!
    const horizontal = from.y === to.y && from.x !== to.x
    const vertical = from.x === to.x && from.y !== to.y
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    const blockers = stationary.map(point => ({ point, along: horizontal
      ? (point.x - from.x) * Math.sign(to.x - from.x)
      : (point.y - from.y) * Math.sign(to.y - from.y) }))
      .filter(({ point, along }) => (horizontal ? Math.abs(point.y - from.y) : vertical ? Math.abs(point.x - from.x) : Infinity) < SIDE_CLEARANCE &&
        along > SIDE_CLEARANCE && along < length - SIDE_CLEARANCE)
      .sort((left, right) => left.along - right.along)
    if ((horizontal || vertical) && blockers.length) {
      const groups: Array<typeof blockers> = []
      for (const blocker of blockers) {
        const group = groups.at(-1)
        const previous = group?.at(-1)
        if (group && previous && blocker.along - previous.along <= SIDE_CLEARANCE * 2) group.push(blocker)
        else groups.push([blocker])
      }
      for (const group of groups) {
        const first = group[0]!
        const last = group.at(-1)!
        const direction = horizontal ? Math.sign(to.x - from.x) : Math.sign(to.y - from.y)
        const before = horizontal
          ? { x: first.point.x - direction * SIDE_CLEARANCE, y: from.y }
          : { x: from.x, y: first.point.y - direction * SIDE_CLEARANCE }
        const after = horizontal
          ? { x: last.point.x + direction * SIDE_CLEARANCE, y: from.y }
          : { x: from.x, y: last.point.y + direction * SIDE_CLEARANCE }
        const floor = deepestRoom(layout, first.point)
        let added = false
        for (const offsetDistance of [SIDE_CLEARANCE, SIDE_CLEARANCE * 1.5, SIDE_CLEARANCE * 2]) {
          for (const side of [1, -1]) {
            const offset = horizontal
              ? { before: { x: before.x, y: before.y + side * offsetDistance }, after: { x: after.x, y: after.y + side * offsetDistance } }
              : { before: { x: before.x + side * offsetDistance, y: before.y }, after: { x: after.x + side * offsetDistance, y: after.y } }
            const candidate = [before, offset.before, offset.after, after]
            const segments = candidate.slice(1).map((point, part) => [candidate[part]!, point] as const)
            const clear = stationary.every(point => segments.every(([a, b]) => distanceToSegment(point, a, b) >= SIDE_CLEARANCE))
            if (clear && candidate.every(point => deepestRoom(layout, point) === floor) &&
                segments.every(([a, b]) => segmentStaysOnFloor(layout, a, b, floor))) {
              for (const point of candidate) append(result, point)
              added = true
              break
            }
          }
          if (added) break
        }
      }
    }
    append(result, to)
  }
  return Object.freeze(result)
}

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (from.x + dx * ratio), point.y - (from.y + dy * ratio))
}

function segmentStaysOnFloor(layout: NestedLayout, from: Point, to: Point, floor: number | null): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const steps = Math.max(1, Math.ceil(length / 12))
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps
    if (deepestRoom(layout, { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }) !== floor) return false
  }
  return true
}

function deepestRoom(layout: NestedLayout, point: Point): number | null {
  return Object.values(layout.rooms)
    .filter(room => roomContains(room, point))
    .sort((left, right) => right.depth - left.depth)[0]?.id ?? null
}
