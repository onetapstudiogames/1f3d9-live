import type { ReplayPlace } from './city/types.ts'
import type { NestedLayout, Room } from './ground/nested.ts'

export function placesWithDrawings(
  places: readonly Pick<ReplayPlace, 'id' | 'has_drawing'>[], layout: NestedLayout,
): readonly number[] {
  const visible = new Set(roomsToDraw(layout).filter(room => !room.quiet).map(room => room.id))
  return [...new Set(places.filter(place => place.has_drawing === true && Number.isSafeInteger(place.id)
    && place.id > 0 && visible.has(place.id)).map(place => place.id))]
}

export type PlaceFloorArt = Readonly<{
  x: number; y: number; width: number; height: number
  cellSize: number; tileSize: number; tileOffsetX: number; tileOffsetY: number; shadeAlpha: number
}>

// Four world pixels per recorded cell keeps the 8 by 8 portrait crisp. The four-pixel
// wall inset clips the repeat while the offsets keep it anchored at the room's corner.
export function placeFloorArt(room: Room): PlaceFloorArt {
  return Object.freeze({
    x: room.x + 4, y: room.y + 4, width: room.width - 8, height: room.height - 8,
    cellSize: 4, tileSize: 32, tileOffsetX: 4, tileOffsetY: 4, shadeAlpha: 0.42,
  })
}

export type CurtainCell = Readonly<{ x: number; y: number; width: number; height: number; color: number }>

export function curtainCells(room: Room, floorColor: number): readonly CurtainCell[] {
  if (!room.quiet) return []
  const folds = [0, 1, 0, 1, 1, 0, 1, 0]
  const colors = [floorColor, (floorColor & 0xfefefe) >>> 1, 0x243c30]
  // An opaque 8 by 8 curtain, with a rail, vertical folds, a centre seam and a hem.
  // Whole-pixel boundaries cover even very large floors with only 64 rectangles.
  return Object.freeze(Array.from({ length: 64 }, (_, index) => {
    const column = index % 8
    const row = Math.floor(index / 8)
    const x = room.x + 4 + Math.floor(column * (room.width - 8) / 8)
    const y = room.y + 4 + Math.floor(row * (room.height - 8) / 8)
    return Object.freeze({
      x, y,
      width: room.x + 4 + Math.floor((column + 1) * (room.width - 8) / 8) - x,
      height: room.y + 4 + Math.floor((row + 1) * (room.height - 8) / 8) - y,
      color: colors[row === 0 ? 2 : row === 7 ? 1 : folds[column]!]!,
    })
  }))
}

export function roomsToDraw(layout: NestedLayout): readonly Room[] {
  return Object.values(layout.rooms).filter(room => {
    let parent = room.parentId === null ? undefined : layout.rooms[room.parentId]
    while (parent) {
      if (parent.quiet) return false
      parent = parent.parentId === null ? undefined : layout.rooms[parent.parentId]
    }
    return true
  }).sort((a, b) => a.depth - b.depth)
}
