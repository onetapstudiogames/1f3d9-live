const DRAWING_SIZE = 8

const ROOM_RESIDENT_SCALE = 7
export const ROOM_RESIDENT_SIZE = DRAWING_SIZE * ROOM_RESIDENT_SCALE
const ROOM_THING_SCALE = 4
export const ROOM_THING_SIZE = DRAWING_SIZE * ROOM_THING_SCALE

export type RoomFigureKind = 'resident' | 'thing'
export type RoomFigureStyle = Readonly<{ scale: number; size: number }>

const FIGURE_STYLES: Readonly<Record<RoomFigureKind, RoomFigureStyle>> = Object.freeze({
  resident: Object.freeze({ scale: ROOM_RESIDENT_SCALE, size: ROOM_RESIDENT_SIZE }),
  thing: Object.freeze({ scale: ROOM_THING_SCALE, size: ROOM_THING_SIZE }),
})

export function roomFigureStyle(kind: RoomFigureKind): RoomFigureStyle {
  return FIGURE_STYLES[kind]
}

export function roomTextResolution(devicePixelRatio: number): number {
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? Math.max(1, devicePixelRatio) : 1
}

