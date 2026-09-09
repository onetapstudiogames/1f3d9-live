import { fetchCensus } from './api.ts'
import { fetchCurrentPlaces } from './current.ts'
import type { PlaceOutline, ReplayPlace, Resident } from './types.ts'
import { nestedLayout } from '../ground/nested.ts'
import { roomIsPublic } from '../room-view.ts'
import { readOptionalOutline } from '../read-issues.ts'
import { placesAfterOutline } from '../current-room.ts'

export async function readCurrentSnapshot(readOutline: (id: number) => Promise<PlaceOutline | null>,
  select: (places: readonly ReplayPlace[], census: readonly Resident[]) => number | null,
  issue: (message: string) => void, existingCapacity?: Readonly<Record<number, number>>) {
  const [directory, census] = await Promise.all([fetchCurrentPlaces(), fetchCensus()])
  const capacity = existingCapacity ?? Object.fromEntries(directory.map(place => [place.id,
    census.filter(row => row.current_place_id === place.id && !row.asleep).length]))
  const layout = nestedLayout(directory, capacity)
  const outlineId = select(directory, census)
  const result = outlineId !== null && roomIsPublic(layout, outlineId)
    ? await readOptionalOutline(outlineId, readOutline) : { outline: null, issue: null }
  if (result.issue) issue(result.issue)
  const places = placesAfterOutline(directory, result.outline)
  return { census, places, capacity, layout: nestedLayout(places, capacity), outline: result.outline, outlineId }
}
