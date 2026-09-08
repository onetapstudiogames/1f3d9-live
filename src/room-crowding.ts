export const ROOM_FIGURE_SIZE = 32
export const ROOM_FIGURE_PITCH = 36

export type RoomCrowdingRect = Readonly<{ x: number; y: number; width: number; height: number }>
export type RoomCrowdingPoint = Readonly<{ x: number; y: number }>
export type RoomCrowdingEntry = Readonly<{
  id: string
  kind: 'resident' | 'thing'
  preferred: RoomCrowdingPoint
  priority: number
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
    ...entries.map(entry => [entry.id, entry.kind, entry.preferred.x, entry.preferred.y, entry.priority])])
}

function isState(value: RoomCrowdingState | Readonly<Record<string, RoomCrowdingPlacement>>): value is RoomCrowdingState {
  return typeof (value as RoomCrowdingState).key === 'string' &&
    typeof (value as RoomCrowdingState).placements === 'object'
}

/** Allocates a frame and reuses the prior state by identity when every allocation input is unchanged. */
export function allocateRoomCrowdingFrame(entries: readonly RoomCrowdingEntry[], band: RoomCrowdingRect,
  previous: RoomCrowdingState | Readonly<Record<string, RoomCrowdingPlacement>> = {}): RoomCrowdingState {
  const ordered = orderedEntries(entries)
  const bandKey = crowdingBandKey(band)
  const key = allocationKey(ordered, bandKey)
  if (isState(previous) && previous.key === key) return previous
  const previousPlacements = isState(previous) ? previous.placements : previous
  const result: Record<string, RoomCrowdingPlacement> = {}
  let candidateChecks = 0
  if (!finiteRect(band) || band.width < ROOM_FIGURE_SIZE || band.height < ROOM_FIGURE_SIZE) {
    for (const entry of ordered) result[entry.id] = hidden(entry)
    return Object.freeze({ bandKey, key, grid: Object.freeze([]), placements: Object.freeze(result),
      metrics: Object.freeze({ gridBuilds: 0, candidateChecks }) })
  }

  const half = ROOM_FIGURE_SIZE / 2
  const minimumX = band.x + half; const maximumX = band.x + band.width - half
  const minimumY = band.y + half; const maximumY = band.y + band.height - half
  const occupied: RoomCrowdingRect[] = []
  const safe = (point: RoomCrowdingPoint): boolean => {
    candidateChecks += 1
    if (point.x < minimumX || point.x > maximumX || point.y < minimumY || point.y > maximumY) return false
    const collisionHalf = ROOM_FIGURE_PITCH / 2
    const bounds = { x: point.x - collisionHalf, y: point.y - collisionHalf,
      width: ROOM_FIGURE_PITCH, height: ROOM_FIGURE_PITCH }
    return !occupied.some(rect => overlaps(bounds, rect))
  }
  const reusedGrid = isState(previous) && previous.bandKey === bandKey
  const grid: readonly RoomCrowdingPoint[] = reusedGrid ? previous.grid : (() => {
    const built: RoomCrowdingPoint[] = []
    for (let y = minimumY; y <= maximumY; y += ROOM_FIGURE_PITCH) {
      for (let x = minimumX; x <= maximumX; x += ROOM_FIGURE_PITCH) built.push(Object.freeze({ x, y }))
    }
    return Object.freeze(built)
  })()

  for (const entry of ordered) {
    const old = previousPlacements[entry.id]
    const oldOffsetIsUsable = old?.visible === true && old.kind === entry.kind &&
      Number.isFinite(old.offsetX) && Number.isFinite(old.offsetY)
    const desired = Object.freeze({
      x: entry.preferred.x + (oldOffsetIsUsable ? old.offsetX : 0),
      y: entry.preferred.y + (oldOffsetIsUsable ? old.offsetY : 0),
    })
    let chosen: RoomCrowdingPoint | undefined
    if (safe(entry.preferred)) chosen = entry.preferred
    if (!chosen && (desired.x !== entry.preferred.x || desired.y !== entry.preferred.y) && safe(desired)) chosen = desired
    if (!chosen) {
      let nearestDistance = Number.POSITIVE_INFINITY
      for (const candidate of grid) {
        if (!safe(candidate)) continue
        const distance = (candidate.x - desired.x) ** 2 + (candidate.y - desired.y) ** 2
        if (distance < nearestDistance) { chosen = candidate; nearestDistance = distance }
      }
    }
    if (!chosen) { result[entry.id] = hidden(entry); continue }
    const placement = Object.freeze({ id: entry.id, kind: entry.kind, x: chosen.x, y: chosen.y, visible: true,
      offsetX: chosen.x - entry.preferred.x, offsetY: chosen.y - entry.preferred.y })
    result[entry.id] = placement
    const collisionHalf = ROOM_FIGURE_PITCH / 2
    occupied.push(Object.freeze({ x: chosen.x - collisionHalf, y: chosen.y - collisionHalf,
      width: ROOM_FIGURE_PITCH, height: ROOM_FIGURE_PITCH }))
  }
  return Object.freeze({ bandKey, key, grid, placements: Object.freeze(result),
    metrics: Object.freeze({ gridBuilds: reusedGrid ? 0 : 1, candidateChecks }) })
}

/** Compatibility helper for callers that only retain placements. */
export function allocateRoomCrowding(entries: readonly RoomCrowdingEntry[], band: RoomCrowdingRect,
  previous: Readonly<Record<string, RoomCrowdingPlacement>> = {}): Readonly<Record<string, RoomCrowdingPlacement>> {
  return allocateRoomCrowdingFrame(entries, band, previous).placements
}

/** Returns the deterministic subset of name plates that can be drawn without overlap. */
export function visibleRoomLabels(boxes: readonly RoomLabelBox[]): ReadonlySet<string> {
  const accepted: RoomLabelBox[] = []
  const visible = new Set<string>()
  const ordered = boxes.filter(box => box && typeof box.id === 'string' && box.id.length > 0 &&
      Number.isFinite(box.priority) && finiteRect(box))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
  for (const box of ordered) {
    if (visible.has(box.id) || accepted.some(other => overlaps(box, other))) continue
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
