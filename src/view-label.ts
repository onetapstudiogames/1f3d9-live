import type { ReplayPlace } from './city/types.ts'
import { recordedRoomName, type PlacePlan } from './places.ts'

export type CameraView = Readonly<{
  director: boolean
  directorStatus: string
  followed: string | null | undefined
  place: Pick<ReplayPlace, 'id' | 'name'> | undefined
  plan: PlacePlan | undefined
  time: number | undefined
  overview: string
}>

export function cameraViewLabel(view: CameraView): string {
  const hasRoom = view.place && view.plan && view.time !== undefined
  const name = hasRoom ? recordedRoomName(view.plan!, view.place!, view.time!) : null
  if (view.director) return view.directorStatus || `Director: watching ${name ?? 'a room whose recorded name is unknown'}`
  if (view.followed !== undefined) return `Following ${view.followed ?? 'a figure the resident list does not name'}`
  return hasRoom ? name ?? 'This room’s earlier name is not recorded.' : view.overview
}
