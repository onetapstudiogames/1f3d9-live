import type { ReplayPlace } from './city/types.ts'
import { publicPlaceIds } from './room-view.ts'

export type RoomFactLink = Readonly<{ id: number; name: string }>
type RoomFactLinks = Readonly<{ parent: RoomFactLink | 'unavailable' | null; children: readonly RoomFactLink[] }>

// The caller supplies the same visibility rule used by the other room facts.
export function roomFactsLinks(places: readonly ReplayPlace[] | null, selectedId: number | null,
  visible: (id: number) => boolean): RoomFactLinks | null {
  if (!places || selectedId === null) return null
  const byId = new Map<number, ReplayPlace>()
  for (const place of places) {
    if (!Number.isSafeInteger(place.id) || place.id < 1) continue
    const previous = byId.get(place.id)
    if (previous && JSON.stringify(previous) !== JSON.stringify(place)) return null
    byId.set(place.id, place)
  }
  const directory = [...byId.values()]
  const publicIds = publicPlaceIds(directory)
  const shown = (place: ReplayPlace): boolean => publicIds.has(place.id)
    && place.name !== '[removed by maintainer]' && visible(place.id)
  const selected = byId.get(selectedId)
  if (!selected || !shown(selected)) return null
  const link = (place: ReplayPlace): RoomFactLink => Object.freeze({ id: place.id, name: place.name })
  const parent = selected.parent_id === null ? null : byId.get(selected.parent_id)
  return Object.freeze({
    parent: parent === null ? null : parent && shown(parent) ? link(parent) : 'unavailable',
    children: Object.freeze(directory.filter(place => place.parent_id === selectedId && shown(place))
      .sort((left, right) => left.id - right.id).map(link)),
  })
}

export function roomFactsHref(href: string, placeId: number): string {
  const url = new URL(href)
  url.searchParams.delete('resident')
  url.searchParams.set('place', String(placeId))
  return `${url.pathname}${url.search}${url.hash}`
}
