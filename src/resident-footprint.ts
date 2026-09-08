import type { StageStandingSpot } from './ground/stage-ground.ts'
import { ROOM_RESIDENT_SIZE } from './room-appearance.ts'

type ResidentCentre = Readonly<{ x: number; y: number }>

export function residentReservationFootprint(key: string, centre: ResidentCentre): StageStandingSpot {
  const offset = ROOM_RESIDENT_SIZE / 2
  return Object.freeze({ key, kind: 'resident', x: centre.x - offset, y: centre.y - offset,
    width: ROOM_RESIDENT_SIZE, height: ROOM_RESIDENT_SIZE })
}
