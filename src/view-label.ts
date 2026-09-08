import type { ReplayPlace } from './city/types.ts'
import { recordedRoomName, type PlacePlan } from './places.ts'

export type CameraView = Readonly<{
  followed: string | null | undefined
  place: Pick<ReplayPlace, 'id' | 'name'> | undefined
  plan: PlacePlan | undefined
  time: number | undefined
  overview: string
}>

export function cameraViewLabel(view: CameraView): string {
  const hasRoom = view.place && view.plan && view.time !== undefined
  const name = hasRoom ? recordedRoomName(view.plan!, view.place!, view.time!) : null
  if (view.followed !== undefined) return view.followed ?? ''
  return hasRoom ? name ?? '' : view.overview
}
