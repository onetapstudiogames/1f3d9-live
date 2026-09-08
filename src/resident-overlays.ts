import { ROOM_RESIDENT_SIZE } from './room-appearance.ts'

const ORIGINAL_RESIDENT_SIZE = 32

export type ResidentOverlayRect = Readonly<{
  x: number
  y: number
  width: number
  height: number
  color: number
  alpha: number
}>

export function residentOverlayDistance(distance: number, residentSize = ROOM_RESIDENT_SIZE): number {
  return distance * residentSize / ORIGINAL_RESIDENT_SIZE
}

export function residentOverlayRects(cells: readonly ResidentOverlayRect[], residentSize = ROOM_RESIDENT_SIZE): readonly ResidentOverlayRect[] {
  return Object.freeze(cells.map(cell => Object.freeze({ ...cell,
    x: residentOverlayDistance(cell.x, residentSize),
    y: residentOverlayDistance(cell.y, residentSize),
    width: residentOverlayDistance(cell.width, residentSize),
    height: residentOverlayDistance(cell.height, residentSize),
  })))
}
