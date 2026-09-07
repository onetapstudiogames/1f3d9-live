import { drawingCells, type DrawingCell } from './city/drawing.ts'
import type { Drawing, ReplayFile, Resident } from './city/types.ts'

export function sleepingDrawingCells(drawing: Drawing | null): readonly DrawingCell[] {
  return drawingCells(drawing).map(cell => {
    if (cell.y <= 2) return { x: 5 + Math.floor(cell.x / 3), y: 1 + cell.y, color: cell.color }
    if (cell.y <= 5) return { x: 1 + Math.floor(cell.x * 5 / 8), y: cell.y, color: cell.color }
    return { x: 2 + Math.floor(cell.x * 3 / 8), y: 9 - cell.y, color: cell.color }
  })
}

export function sleepingResidents(replay: ReplayFile, census: readonly Resident[]): ReadonlySet<number> {
  const result = new Set<number>()
  const windowStart = Date.parse(replay.window_start)
  if (!Number.isFinite(windowStart)) return result

  const activeHandles = new Set(replay.timeline.map(row => row.actor))
  for (const resident of census) {
    const handle = typeof resident.handle === 'string' ? resident.handle.trim() : ''
    const joinedAt = Date.parse(resident.joined_at)
    if (resident.asleep !== true || handle.length === 0) continue
    if (!Number.isInteger(resident.current_place_id)) continue
    if (!Number.isFinite(joinedAt) || joinedAt > windowStart) continue
    if (Object.prototype.hasOwnProperty.call(replay.start, `resident:${resident.id}`)) continue
    if (activeHandles.has(resident.handle)) continue
    result.add(resident.id)
  }
  return result
}
