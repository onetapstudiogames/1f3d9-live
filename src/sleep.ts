import { drawingCells, type DrawingCell } from './city/drawing.ts'
import type { Drawing, ReplayFile, Resident } from './city/types.ts'

// Lying down is a quarter turn of the whole 8 by 8 grid, anticlockwise, so the head that
// stood at the top now points left and the feet point right. Every painted cell lands on its
// own cell inside the grid, so the resident keeps every pixel and every colour of its own art.
export function sleepingDrawingCells(drawing: Drawing | null): readonly DrawingCell[] {
  return drawingCells(drawing).map(cell => ({ x: cell.y, y: 7 - cell.x, color: cell.color }))
}

export function sleepingResidents(replay: ReplayFile, census: readonly Resident[]): ReadonlySet<number> {
  const result = new Set<number>()
  const windowStart = Date.parse(replay.window_start)
  if (!Number.isFinite(windowStart)) return result

  const activeHandles = new Set(replay.timeline.map(row => (typeof row.actor === 'string' ? row.actor.trim() : '')))
  for (const resident of census) {
    const handle = typeof resident.handle === 'string' ? resident.handle.trim() : ''
    const joinedAt = Date.parse(resident.joined_at)
    if (resident.asleep !== true || handle.length === 0) continue
    if (!Number.isInteger(resident.current_place_id)) continue
    if (!Number.isFinite(joinedAt) || joinedAt > windowStart) continue
    if (Object.prototype.hasOwnProperty.call(replay.start, `resident:${resident.id}`)) continue
    if (activeHandles.has(handle)) continue
    result.add(resident.id)
  }
  return result
}
