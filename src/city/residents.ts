import type { InitialResident, ReplayFile, Resident } from './types.ts'

export function residentIndex(census: readonly Resident[]): ReadonlyMap<string, Resident> {
  const index = new Map<string, Resident>()
  for (const resident of census) if (resident.handle) index.set(resident.handle, resident)
  return index
}

export function initialResidents(replay: ReplayFile, census: readonly Resident[]): readonly InitialResident[] {
  const byId = new Map(census.map(resident => [resident.id, resident] as const))
  const result: InitialResident[] = []
  const startedIds = new Set<number>()
  for (const [key, start] of Object.entries(replay.start)) {
    const match = /^resident:(\d+)$/.exec(key)
    if (!match) continue
    const id = Number(match[1])
    startedIds.add(id)
    if (!start || typeof start.place_id !== 'number' || !Number.isInteger(start.place_id)) continue
    const resident = byId.get(id)
    result.push({ id, handle: resident?.handle || `resident ${id}`, placeId: start.place_id })
  }

  const timelineActors = new Set(replay.timeline.flatMap(event =>
    typeof event.actor === 'string' && event.actor.trim().length > 0 ? [event.actor.trim()] : [],
  ))
  const windowStart = Date.parse(replay.window_start)
  for (const resident of census) {
    if (startedIds.has(resident.id) || !resident.handle || resident.current_place_id === null) continue
    const joinedAt = Date.parse(resident.joined_at)
    if (timelineActors.has(resident.handle) || !Number.isFinite(joinedAt) || !Number.isFinite(windowStart) || joinedAt > windowStart) continue
    result.push({ id: resident.id, handle: resident.handle, placeId: resident.current_place_id })
  }
  return result
}

// The record's own key ("resident:12") is a key, not a name. When the resident list cannot be
// read, that key is all a figure has, and the footer already says the figures are shown without
// names; so this returns nothing and the figure is drawn with no plate.
export function residentNamePlate(handle: unknown): string | null {
  if (typeof handle !== 'string') return null
  const name = handle.trim()
  if (name.length === 0 || /^resident[: ]\d+$/.test(name)) return null
  return name
}
