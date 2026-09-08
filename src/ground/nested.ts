export type Point = Readonly<{ x: number; y: number }>

export type Place = Readonly<{
  id: number
  parent_id: number | null
  name?: string
  quiet?: boolean
}>

export type Room = Readonly<{
  id: number
  parentId: number | null
  name: string
  quiet: boolean
  depth: number
  x: number
  y: number
  width: number
  height: number
  door: Point
  standing: Readonly<{ x: number; y: number; width: number; height: number }>
  children: readonly number[]
  notch?: Readonly<{ width: number; height: number }> | null
  shelf?: Readonly<{ row: number; top: number; bottom: number; laneAbove: number; laneBelow: number }> | null
}>

export type NestedLayout = Readonly<{
  rooms: Readonly<Record<number, Room>>
  rootId: number
  width: number
  height: number
}>

export const ROOM_PADDING = 48
export const ROOM_GAP = 32
const MINIMUM_WIDTH = 240
const MINIMUM_HEIGHT = 170
const STANDING_PITCH = 48

type PlannedChild = Readonly<{ id: number; x: number; y: number; row: number; top: number; bottom: number;
  laneAbove: number; laneBelow: number }>
type Plan = Readonly<{
  id: number
  width: number
  height: number
  standingHeight: number
  children: readonly PlannedChild[]
}>

const compareIds = (left: number, right: number): number => left - right
const variant = (id: number): number => Math.abs(Math.imul(id, 1103515245) + 12345) % 3
const variedSize = (id: number, width: number, height: number): readonly [number, number] => {
  const kind = variant(id)
  if (kind === 0) return [width + Math.max(48, Math.round(width * 0.18 / 8) * 8), height]
  if (kind === 1) return [width, height + Math.max(40, Math.round(height * 0.2 / 8) * 8)]
  return [width, height]
}

export function nestedLayout(
  places: readonly Place[],
  capacity: Readonly<Record<number, number>> = {},
): NestedLayout {
  const byId = new Map<number, Place>()
  for (const place of places) {
    if (!Number.isSafeInteger(place.id) || byId.has(place.id)) throw new Error('Every place needs a unique integer id')
    byId.set(place.id, place)
  }
  const roots = places.filter(place => place.parent_id === null)
  if (roots.length !== 1) throw new Error('The map must have exactly one root place')
  for (const place of places) {
    if (place.parent_id !== null && !byId.has(place.parent_id)) throw new Error(`Place ${String(place.id)} has no parent in the map`)
  }
  const root = roots[0]!
  const childIds = new Map<number, number[]>()
  for (const place of places) {
    if (place.parent_id === null) continue
    childIds.set(place.parent_id, [...(childIds.get(place.parent_id) ?? []), place.id])
  }
  for (const children of childIds.values()) children.sort(compareIds)

  const plans = new Map<number, Plan>()
  const visiting = new Set<number>()
  const makePlan = (id: number): Plan => {
    const existing = plans.get(id)
    if (existing) return existing
    if (visiting.has(id)) throw new Error('The place parents contain a cycle')
    visiting.add(id)
    const children = (childIds.get(id) ?? []).map(makePlan)
    const requested = Number.isFinite(capacity[id]) ? Math.max(0, Math.floor(capacity[id]!)) : 0
    const slots = requested === 0 ? 4 : requested * 4
    const columns = Math.max(4, Math.ceil(Math.sqrt(slots * 1.4)))
    const standingWidth = columns * STANDING_PITCH
    const standingRows = Math.ceil(slots / columns)
    const standingHeight = Math.max(90, 26 + standingRows * STANDING_PITCH)
    // The free-spot helper keeps 16px at both edges around a 32px sprite.
    const standingOuterWidth = Math.max(MINIMUM_WIDTH, standingWidth + ROOM_PADDING + 16)
    if (!children.length) {
      const [width, height] = variedSize(id, standingOuterWidth, Math.max(MINIMUM_HEIGHT, standingHeight + ROOM_PADDING + 32))
      const plan = Object.freeze({ id, width, height, standingHeight, children: Object.freeze([]) })
      plans.set(id, plan)
      visiting.delete(id)
      return plan
    }
    const totalArea = children.reduce((sum, child) => sum + (child.width + ROOM_GAP) * (child.height + ROOM_GAP), 0)
    const shelfTarget = Math.max(standingOuterWidth - ROOM_PADDING * 2, ...children.map(child => child.width), Math.sqrt(totalArea * 1.25))
    const rows: Plan[][] = []
    let row: Plan[] = []
    let used = 0
    for (const child of children) {
      const next = row.length ? used + ROOM_GAP + child.width : child.width
      if (row.length && next > shelfTarget) {
        rows.push(row)
        row = []
        used = 0
      }
      row.push(child)
      used = row.length === 1 ? child.width : used + ROOM_GAP + child.width
    }
    if (row.length) rows.push(row)
    const placements: PlannedChild[] = []
    const gap = id === root.id ? Math.max(56, Math.ceil(Math.max(...children.map(child => Math.max(child.width, child.height))) * 0.04 / 8) * 8)
      : ROOM_GAP + 8
    let y = ROOM_PADDING + standingHeight + gap
    let widest = 0
    for (const [rowIndex, shelf] of rows.entries()) {
      const shelfHeight = Math.max(...shelf.map(child => child.height))
      let x = ROOM_PADDING + (rowIndex % 2) * (id === root.id ? gap / 2 : 24)
      for (const child of shelf) {
        const childY = y + shelfHeight - child.height
        placements.push(Object.freeze({ id: child.id, x, y: childY, row: rowIndex, top: y,
          bottom: y + shelfHeight, laneAbove: y - gap / 2, laneBelow: y + shelfHeight + gap / 2 }))
        x += child.width + gap
      }
      widest = Math.max(widest, x - gap + ROOM_PADDING)
      y += shelfHeight + gap
    }
    const baseWidth = Math.max(standingOuterWidth, widest); const baseHeight = Math.max(MINIMUM_HEIGHT, y + ROOM_PADDING - gap)
    const [width, height] = id === root.id ? [baseWidth, baseHeight] : variedSize(id, baseWidth, baseHeight)
    const plan = Object.freeze({
      id,
      width, height,
      standingHeight,
      children: Object.freeze(placements),
    })
    plans.set(id, plan)
    visiting.delete(id)
    return plan
  }

  const rootPlan = makePlan(root.id)
  if (plans.size !== places.length) throw new Error('Every place must descend from the one root')
  const rooms: Record<number, Room> = {}
  const placeRooms = (plan: Plan, x: number, y: number, depth: number, parentId: number | null, doorIndex = 1,
    shelf: PlannedChild | null = null): void => {
    const place = byId.get(plan.id)!
    // Children are sorted by id: successive siblings differ, and each four use all walls.
    const door = [
      { x: x + plan.width, y: y + plan.height / 2 },
      { x: x + plan.width / 2, y: y + plan.height },
      { x, y: y + plan.height / 2 },
      { x: x + plan.width / 2, y },
    ][doorIndex % 4]!
    const lastRow = Math.max(-1, ...plan.children.map(child => child.row))
    const lastChildren = plan.children.filter(child => child.row === lastRow)
    // Leave the child door's outside lane (16px) and a margin beside the missing corner.
    const notchWidth = lastChildren.length ? Math.max(8, plan.width - Math.max(...lastChildren.map(child => child.x + plans.get(child.id)!.width)) - 24) : 40
    const notchHeight = lastChildren.length ? Math.max(40, plan.height - lastChildren[0]!.top) : 40
    rooms[plan.id] = Object.freeze({
      id: plan.id, parentId, name: place.name ?? `place ${String(plan.id)}`, quiet: place.quiet === true,
      depth, x, y, width: plan.width, height: plan.height,
      door: Object.freeze(door),
      standing: Object.freeze({ x: x + ROOM_PADDING / 2, y: y + ROOM_PADDING / 2, width: plan.width - ROOM_PADDING, height: plan.standingHeight }),
      children: Object.freeze(plan.children.map(child => child.id)),
      notch: depth > 0 && (depth === 1 || variant(plan.id) === 2) ? Object.freeze({ width: Math.floor(Math.min(notchWidth, plan.width / 3)),
        height: Math.floor(Math.min(notchHeight, plan.height / 3, plan.height - plan.standingHeight - ROOM_PADDING)) }) : null,
      shelf: shelf ? Object.freeze({ row: shelf.row, top: y - shelf.y + shelf.top, bottom: y - shelf.y + shelf.bottom,
        laneAbove: y - shelf.y + shelf.laneAbove, laneBelow: y - shelf.y + shelf.laneBelow }) : null,
    })
    for (const [index, child] of plan.children.entries()) placeRooms(plans.get(child.id)!, x + child.x, y + child.y, depth + 1, plan.id, index, child)
  }
  placeRooms(rootPlan, 0, 0, 0, null)
  return Object.freeze({ rooms: Object.freeze(rooms), rootId: root.id, width: rootPlan.width, height: rootPlan.height })
}
