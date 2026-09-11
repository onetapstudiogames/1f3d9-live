import { ROOM_RESIDENT_SIZE, ROOM_THING_SIZE } from './room-appearance.ts'

export const ROOM_FIGURE_SIZE = ROOM_RESIDENT_SIZE
export const ROOM_FIGURE_PITCH = ROOM_FIGURE_SIZE + 4
export const ROOM_THING_PITCH = ROOM_THING_SIZE + 4

export type RoomCrowdingRect = Readonly<{ x: number; y: number; width: number; height: number }>
export type RoomCrowdingPoint = Readonly<{ x: number; y: number }>
export type RoomCrowdingRoute = Readonly<{ points: readonly RoomCrowdingPoint[]; radius: number }>
export type RoomCrowdingEntry = Readonly<{
  id: string
  kind: 'resident' | 'thing'
  preferred: RoomCrowdingPoint
  priority: number
  stable?: boolean
  displacesStable?: boolean
}>
export type RoomCrowdingPlacement = Readonly<{
  id: string
  kind: 'resident' | 'thing'
  x: number
  y: number
  visible: boolean
  offsetX: number
  offsetY: number
}>
export type RoomLabelBox = Readonly<RoomCrowdingRect & { id: string; priority: number }>
export type RoomFigureBox = Readonly<RoomCrowdingRect & { id: string }>
export type RoomCrowdingMetrics = Readonly<{ gridBuilds: number; candidateChecks: number }>
export type RoomCrowdingState = Readonly<{
  bandKey: string
  key: string
  grid: readonly RoomCrowdingPoint[]
  placements: Readonly<Record<string, RoomCrowdingPlacement>>
  metrics: RoomCrowdingMetrics
}>

const LABEL_EDGE_TOLERANCE = 1e-6

const finiteRect = (rect: RoomCrowdingRect): boolean =>
  [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0

const overlaps = (left: RoomCrowdingRect, right: RoomCrowdingRect): boolean =>
  left.x < right.x + right.width && left.x + left.width > right.x &&
  left.y < right.y + right.height && left.y + left.height > right.y

function hidden(entry: RoomCrowdingEntry): RoomCrowdingPlacement {
  return Object.freeze({ id: entry.id, kind: entry.kind, x: entry.preferred.x, y: entry.preferred.y,
    visible: false, offsetX: 0, offsetY: 0 })
}

function orderedEntries(entries: readonly RoomCrowdingEntry[]): readonly RoomCrowdingEntry[] {
  const seen = new Set<string>()
  return entries.filter(entry => entry && typeof entry.id === 'string' && entry.id.length > 0 &&
      (entry.kind === 'resident' || entry.kind === 'thing') && Number.isFinite(entry.priority) &&
      Number.isFinite(entry.preferred?.x) && Number.isFinite(entry.preferred?.y))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .filter(entry => {
      if (seen.has(entry.id)) return false
      seen.add(entry.id)
      return true
    })
}

function crowdingBandKey(band: RoomCrowdingRect): string {
  return JSON.stringify([band.x, band.y, band.width, band.height])
}

function allocationKey(entries: readonly RoomCrowdingEntry[], bandKey: string): string {
  return JSON.stringify([bandKey,
    ...entries.map(entry => [entry.id, entry.kind, entry.preferred.x, entry.preferred.y, entry.priority,
      Boolean(entry.stable), Boolean(entry.displacesStable)])])
}

function isState(value: RoomCrowdingState | Readonly<Record<string, RoomCrowdingPlacement>>): value is RoomCrowdingState {
  return typeof (value as RoomCrowdingState).key === 'string' &&
    typeof (value as RoomCrowdingState).placements === 'object'
}

/** Allocates a frame and reuses the prior state by identity when every allocation input is unchanged. */
export function allocateRoomCrowdingFrame(entries: readonly RoomCrowdingEntry[], band: RoomCrowdingRect,
  previous: RoomCrowdingState | Readonly<Record<string, RoomCrowdingPlacement>> = {},
  reservations: readonly RoomCrowdingRect[] = [], routes: readonly RoomCrowdingRoute[] = []): RoomCrowdingState {
  const ordered = orderedEntries(entries)
  const bandKey = crowdingBandKey(band)
  const reserved = reservations.filter(finiteRect)
  const key = allocationKey(ordered, bandKey) + JSON.stringify([reserved, routes])
  if (isState(previous) && previous.key === key) return previous
  const previousPlacements = isState(previous) ? previous.placements : previous
  const retentionRank = (entry: RoomCrowdingEntry): number => entry.displacesStable ? 2
    : entry.stable && previousPlacements[entry.id]?.visible && previousPlacements[entry.id]?.kind === entry.kind ? 1 : 0
  const allocationOrder = [...ordered].sort((left, right) => retentionRank(right) - retentionRank(left)
    || right.priority - left.priority || left.id.localeCompare(right.id))
  const result: Record<string, RoomCrowdingPlacement> = {}
  let candidateChecks = 0
  if (!finiteRect(band)) {
    for (const entry of ordered) result[entry.id] = hidden(entry)
    return Object.freeze({ bandKey, key, grid: Object.freeze([]), placements: Object.freeze(result),
      metrics: Object.freeze({ gridBuilds: 0, candidateChecks }) })
  }

  const occupied: RoomCrowdingRect[] = [...reserved]
  const sizeFor = (kind: RoomCrowdingEntry['kind']): number => kind === 'resident' ? ROOM_FIGURE_SIZE : ROOM_THING_SIZE
  const pitchFor = (kind: RoomCrowdingEntry['kind']): number => kind === 'resident' ? ROOM_FIGURE_PITCH : ROOM_THING_PITCH
  const safe = (point: RoomCrowdingPoint, kind: RoomCrowdingEntry['kind']): boolean => {
    candidateChecks += 1
    const size = sizeFor(kind); const half = size / 2
    const minimumX = band.x + half; const maximumX = band.x + band.width - half
    const minimumY = band.y + half; const maximumY = band.y + band.height - half
    if (point.x < minimumX || point.x > maximumX || point.y < minimumY || point.y > maximumY) return false
    const collisionHalf = pitchFor(kind) / 2
    const bounds = { x: point.x - collisionHalf, y: point.y - collisionHalf,
      width: pitchFor(kind), height: pitchFor(kind) }
    return !occupied.some(rect => overlaps(bounds, rect)) && !routes.some(route => routeCrosses(bounds, route))
  }
  const reusedGrid = isState(previous) && previous.bandKey === bandKey
  const buildGrid = (kind: RoomCrowdingEntry['kind']): readonly RoomCrowdingPoint[] => {
    const half = sizeFor(kind) / 2; const pitch = pitchFor(kind)
    const minimumX = band.x + half; const maximumX = band.x + band.width - half
    const minimumY = band.y + half; const maximumY = band.y + band.height - half
    const built: RoomCrowdingPoint[] = []
    for (let y = minimumY; y <= maximumY; y += pitch) {
      for (let x = minimumX; x <= maximumX; x += pitch) built.push(Object.freeze({ x, y }))
    }
    return Object.freeze(built)
  }
  const grid: readonly RoomCrowdingPoint[] = reusedGrid ? previous.grid : buildGrid('resident')
  const thingGrid = buildGrid('thing')

  for (const entry of allocationOrder) {
    const old = previousPlacements[entry.id]
    const oldOffsetIsUsable = old?.visible === true && old.kind === entry.kind &&
      Number.isFinite(old.offsetX) && Number.isFinite(old.offsetY)
    const desired = Object.freeze({
      x: entry.preferred.x + (oldOffsetIsUsable ? old.offsetX : 0),
      y: entry.preferred.y + (oldOffsetIsUsable ? old.offsetY : 0),
    })
    let chosen: RoomCrowdingPoint | undefined
    if (entry.kind === 'resident' && safe(entry.preferred, entry.kind)) chosen = entry.preferred
    if (!chosen && oldOffsetIsUsable && safe(desired, entry.kind)) chosen = desired
    if (!chosen) {
      let nearestDistance = Number.POSITIVE_INFINITY
      for (const candidate of entry.kind === 'resident' ? grid : thingGrid) {
        if (!safe(candidate, entry.kind)) continue
        const distance = (candidate.x - desired.x) ** 2 + (candidate.y - desired.y) ** 2
        if (distance < nearestDistance) { chosen = candidate; nearestDistance = distance }
      }
    }
    if (!chosen && safe(entry.preferred, entry.kind)) chosen = entry.preferred
    if (!chosen) { result[entry.id] = hidden(entry); continue }
    const placement = Object.freeze({ id: entry.id, kind: entry.kind, x: chosen.x, y: chosen.y, visible: true,
      offsetX: chosen.x - entry.preferred.x, offsetY: chosen.y - entry.preferred.y })
    result[entry.id] = placement
    const collisionHalf = pitchFor(entry.kind) / 2
    occupied.push(Object.freeze({ x: chosen.x - collisionHalf, y: chosen.y - collisionHalf,
      width: pitchFor(entry.kind), height: pitchFor(entry.kind) }))
  }
  return Object.freeze({ bandKey, key, grid, placements: Object.freeze(result),
    metrics: Object.freeze({ gridBuilds: reusedGrid ? 0 : 1, candidateChecks }) })
}

// Intersect the centre path with the seat expanded by the walking figure's radius.
// A diagonal reserves its swept squares, not the entire rectangle between its ends.
function routeCrosses(seat: RoomCrowdingRect, route: RoomCrowdingRoute): boolean {
  const radius = route.radius
  if (!Number.isFinite(radius) || radius < 0) return false
  const minimum = { x: seat.x - radius, y: seat.y - radius }
  const maximum = { x: seat.x + seat.width + radius, y: seat.y + seat.height + radius }
  return route.points.slice(1).some((to, index) => {
    const from = route.points[index]!
    let enter = 0; let leave = 1
    for (const axis of ['x', 'y'] as const) {
      if (!Number.isFinite(from[axis]) || !Number.isFinite(to[axis])) return false
      const delta = to[axis] - from[axis]
      if (delta === 0) { if (from[axis] <= minimum[axis] || from[axis] >= maximum[axis]) return false; continue }
      const first = (minimum[axis] - from[axis]) / delta; const last = (maximum[axis] - from[axis]) / delta
      enter = Math.max(enter, Math.min(first, last)); leave = Math.min(leave, Math.max(first, last))
      if (enter >= leave) return false
    }
    return enter < leave
  })
}

/** Returns the deterministic subset of name plates that can be drawn without overlap. */
export function visibleRoomLabels(boxes: readonly RoomLabelBox[], figures: readonly RoomFigureBox[] = []): ReadonlySet<string> {
  const accepted: RoomLabelBox[] = []
  const visible = new Set<string>()
  const ordered = boxes.filter(box => box && typeof box.id === 'string' && box.id.length > 0 &&
      Number.isFinite(box.priority) && finiteRect(box))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
  for (const box of ordered) {
    if (visible.has(box.id) || accepted.some(other => overlaps(box, other)) ||
        figures.some(figure => figure.id !== box.id && finiteRect(figure) && overlaps(box, figure))) continue
    visible.add(box.id)
    accepted.push(box)
  }
  return visible
}

/** Allows only sub-pixel floating-point noise at viewport edges. */
export function roomLabelFitsViewport(box: RoomCrowdingRect, width: number, height: number): boolean {
  return finiteRect(box) && Number.isFinite(width) && Number.isFinite(height) && width >= 0 && height >= 0 &&
    box.x >= -LABEL_EDGE_TOLERANCE && box.y >= -LABEL_EDGE_TOLERANCE &&
    box.x + box.width <= width + LABEL_EDGE_TOLERANCE &&
    box.y + box.height <= height + LABEL_EDGE_TOLERANCE
}
