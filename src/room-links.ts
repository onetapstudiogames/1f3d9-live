import type { ReplayPlace, Resident } from './city/types.ts'
import { residentNamePlate } from './city/residents.ts'
import { busiestRoom, publicPlaceIds } from './room-view.ts'

type RoomLink = Readonly<{ kind: 'none' } | { kind: 'place'; id: number }
  | { kind: 'resident'; target: string | number } | { kind: 'invalid'; target: 'place' | 'resident' }>
export type RoomLinkSelection = Readonly<{ kind: 'none' } | { kind: 'place'; id: number }
  | { kind: 'resident'; handle: string }>
type OpeningRoom = Readonly<{ roomId: number | null; following: number | null; message: string | null }>

function positiveId(value: string): number | null {
  const id = /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

// Presence of resident wins even when its value is unavailable; never silently use place instead.
export function parseRoomLink(search: string): RoomLink {
  const params = new URLSearchParams(search)
  if (params.has('resident')) {
    const value = params.get('resident')!
    const target = /^\d+$/.test(value) ? positiveId(value) : value
    return target !== null && value.length > 0 && !/\s|[\u0000-\u001f\u007f]/.test(value)
      ? Object.freeze({ kind: 'resident', target }) : Object.freeze({ kind: 'invalid', target: 'resident' })
  }
  if (!params.has('place')) return Object.freeze({ kind: 'none' })
  const id = positiveId(params.get('place')!)
  return id === null ? Object.freeze({ kind: 'invalid', target: 'place' }) : Object.freeze({ kind: 'place', id })
}

export function resolveRoomLink(link: RoomLink, places: readonly ReplayPlace[], census: readonly Resident[]): OpeningRoom {
  const fallback = (reason: string | null): OpeningRoom => {
    const roomId = busiestRoom(places, census)
    const ending = roomId === null ? 'No public room is available.' : 'Showing the usual opening room.'
    return Object.freeze({ roomId, following: null, message: reason ? `${reason} ${ending}` : null })
  }
  if (link.kind === 'none') return fallback(null)
  if (link.kind === 'invalid') return fallback(`That ${link.target === 'place' ? 'room' : 'resident'} is unavailable.`)
  const publicIds = publicPlaceIds(places)
  if (link.kind === 'place') return publicIds.has(link.id)
    ? Object.freeze({ roomId: link.id, following: null, message: null }) : fallback('That room is unavailable.')
  const resident = census.find(row => typeof link.target === 'number' ? row.id === link.target : row.handle === link.target)
  if (!resident || !residentNamePlate(resident.handle)) return fallback('That resident is unavailable.')
  if (resident.asleep) return fallback('That resident is asleep.')
  if (resident.current_place_id === null || !publicIds.has(resident.current_place_id)) {
    return fallback('That resident is not in a public room.')
  }
  return Object.freeze({ roomId: resident.current_place_id, following: resident.id, message: null })
}

export function replaceRoomLink(history: Pick<History, 'state' | 'replaceState'>, href: string, selection: RoomLinkSelection): void {
  const url = new URL(href)
  url.searchParams.delete('place')
  url.searchParams.delete('resident')
  if (selection.kind === 'place') url.searchParams.set('place', String(selection.id))
  if (selection.kind === 'resident') url.searchParams.set('resident', selection.handle)
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
}
