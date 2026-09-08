// Pure presentation helpers salvaged from the city's former live stage.
import { ROOM_RESIDENT_SIZE, ROOM_THING_SIZE } from '../room-appearance.ts'

export type StageStandingEntry = Readonly<{ key: string; kind: 'resident' | 'thing' }>
export type StageStandingSpot = Readonly<{ key: string; kind: 'resident' | 'thing'; x: number; y: number; width: number; height: number }>
export type StageGroundRect = Readonly<{ x: number; y: number; width: number; height: number }>

export function stageFindFreeSpots(
  entries: readonly StageStandingEntry[],
  room: StageGroundRect,
  previous: Readonly<Record<string, StageStandingSpot>> = {},
  extraGround: readonly StageGroundRect[] = [],
  fixedObstacles: readonly StageStandingSpot[] = [],
): Readonly<Record<string, StageStandingSpot>> {
  if (![room.x, room.y, room.width, room.height].every(Number.isFinite) ||
      room.width <= 0 || room.height <= 0) return Object.freeze({})
  const sizeFor = (kind: StageStandingEntry['kind']): number =>
    kind === 'resident' ? ROOM_RESIDENT_SIZE : ROOM_THING_SIZE
  const clearance = ROOM_THING_SIZE / 2
  const searchAreasFor = (spriteSize: number) => [room, ...extraGround].flatMap(area => {
    if (![area.x, area.y, area.width, area.height].every(Number.isFinite) ||
        area.width <= 0 || area.height <= 0) return []
    const minimumX = Math.ceil(area.x + clearance)
    const minimumY = Math.ceil(area.y + clearance)
    const maximumX = Math.floor(area.x + area.width - clearance - spriteSize)
    const maximumY = Math.floor(area.y + area.height - clearance - spriteSize)
    const xSpan = maximumX - minimumX + 1
    const ySpan = maximumY - minimumY + 1
    if (xSpan <= 0 || ySpan <= 0) return []
    return [Object.freeze({ minimumX, minimumY, maximumX, maximumY, xSpan, ySpan, candidateCount: xSpan * ySpan })]
  })
  const hash = (value: string): number => {
    let result = 2166136261
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index)
      result = Math.imul(result, 16777619)
    }
    return result >>> 0
  }
  const ordered = [...new Map(entries.filter(entry =>
    (entry.kind === 'resident' || entry.kind === 'thing') && typeof entry.key === 'string' && entry.key.length > 0)
    .map(entry => [entry.key, entry])).values()].sort((left, right) => left.key.localeCompare(right.key))
  const overlaps = (left: StageGroundRect, right: StageGroundRect): boolean =>
    left.x < right.x + right.width + clearance && left.x + left.width + clearance > right.x &&
    left.y < right.y + right.height + clearance && left.y + left.height + clearance > right.y
  const bucketSize = Math.max(ROOM_RESIDENT_SIZE, ROOM_THING_SIZE) + clearance
  const occupiedByBucket = new Map<number, Map<number, StageStandingSpot[]>>()
  const bucketCoordinate = (value: number): number => Math.floor(value / bucketSize)
  const addOccupied = (spot: StageStandingSpot): void => {
    const minimumX = bucketCoordinate(spot.x - clearance)
    const maximumX = bucketCoordinate(spot.x + spot.width + clearance)
    const minimumY = bucketCoordinate(spot.y - clearance)
    const maximumY = bucketCoordinate(spot.y + spot.height + clearance)
    for (let x = minimumX; x <= maximumX; x += 1) {
      const bucketColumn = occupiedByBucket.get(x) || new Map<number, StageStandingSpot[]>()
      for (let y = minimumY; y <= maximumY; y += 1) {
        bucketColumn.set(y, [...(bucketColumn.get(y) || []), spot])
      }
      occupiedByBucket.set(x, bucketColumn)
    }
  }
  for (const obstacle of fixedObstacles) addOccupied(obstacle)
  const collides = (area: StageGroundRect): boolean => {
    const minimumX = bucketCoordinate(area.x)
    const maximumX = bucketCoordinate(area.x + area.width)
    const minimumY = bucketCoordinate(area.y)
    const maximumY = bucketCoordinate(area.y + area.height)
    for (let x = minimumX; x <= maximumX; x += 1) {
      const bucketColumn = occupiedByBucket.get(x)
      if (!bucketColumn) continue
      for (let y = minimumY; y <= maximumY; y += 1) {
        if ((bucketColumn.get(y) || []).some(occupied => overlaps(area, occupied))) return true
      }
    }
    return false
  }
  const result: Record<string, StageStandingSpot> = {}
  for (const entry of ordered) {
    const spriteSize = sizeFor(entry.kind)
    const searchAreas = searchAreasFor(spriteSize)
    const spot = previous[entry.key]
    if (!spot || spot.kind !== entry.kind ||
        ![spot.x, spot.y, spot.width, spot.height].every(Number.isFinite) ||
        spot.width !== spriteSize || spot.height !== spriteSize ||
        !searchAreas.some(area => spot.x >= area.minimumX && spot.y >= area.minimumY &&
          spot.x <= area.maximumX && spot.y <= area.maximumY) || collides(spot)) continue
    const retained = Object.freeze({ key: entry.key, kind: entry.kind, x: spot.x, y: spot.y, width: spriteSize, height: spriteSize })
    result[entry.key] = retained
    addOccupied(retained)
  }
  for (const entry of ordered) {
    if (result[entry.key]) continue
    const spriteSize = sizeFor(entry.kind)
    const searchAreas = searchAreasFor(spriteSize)
    if (!searchAreas.length) continue
    const candidateCount = searchAreas.reduce((sum, area) => sum + area.candidateCount, 0)
    const firstCandidate = hash(entry.key) % candidateCount
    const candidateRectAt = (candidateIndex: number): StageGroundRect => {
      let candidate = candidateIndex
      let searchArea = searchAreas[0]!
      for (const candidateArea of searchAreas) {
        searchArea = candidateArea
        if (candidate < candidateArea.candidateCount) break
        candidate -= candidateArea.candidateCount
      }
      return Object.freeze({ x: searchArea.minimumX + candidate % searchArea.xSpan, y: searchArea.minimumY + Math.floor(candidate / searchArea.xSpan), width: spriteSize, height: spriteSize })
    }
    let chosen: Readonly<{ x: number; y: number }> | null = null
    let probe = hash('free:' + entry.key)
    for (let attempt = 0; attempt < 64; attempt += 1) {
      probe = (Math.imul(probe, 1664525) + 1013904223) >>> 0
      const candidateRect = candidateRectAt(probe % candidateCount)
      if (!collides(candidateRect)) { chosen = candidateRect; break }
    }
    for (let offset = 0; offset < candidateCount; offset += 1) {
      if (chosen) break
      const candidateRect = candidateRectAt((firstCandidate + offset) % candidateCount)
      if (!collides(candidateRect)) { chosen = candidateRect; break }
    }
    if (!chosen) continue
    const placed = Object.freeze({ key: entry.key, kind: entry.kind, x: chosen.x, y: chosen.y, width: spriteSize, height: spriteSize })
    result[entry.key] = placed
    addOccupied(placed)
  }
  return Object.freeze(result)
}
