import type { PlaceOutline, ReplayPlace } from './city/types.ts'

export function placesAfterOutline(places: readonly ReplayPlace[], outline: PlaceOutline | null): readonly ReplayPlace[] {
  if (!outline) return places
  return Object.freeze(places.map(place => place.id !== outline.placeId ? place : Object.freeze({ ...place,
    name: outline.name ?? place.name, parent_id: outline.parentId === undefined ? place.parent_id : outline.parentId,
    owner: outline.owner === undefined ? place.owner : outline.owner,
    owner_id: outline.ownerId === undefined ? place.owner_id : outline.ownerId, quiet: outline.quiet,
  })))
}
