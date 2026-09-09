import Phaser from 'phaser'
import type { NestedLayout, Room } from '../ground/nested.ts'
import { daylightAt, roomWindows, windowsLit } from '../daylight.ts'
import type { Drawing } from '../city/types.ts'
import { drawingCells } from '../city/drawing.ts'
import { curtainCells, placeFloorArt, roomsToDraw, undrawnFloor } from '../room-art.ts'
import { roomFloorRects, roomOutline } from '../ground/room-shape.ts'
import { TiledFloor } from './TiledFloor.ts'
import { removableOnce } from '../scene-lifecycle.ts'

export class RoomView {
  private readonly tint: Phaser.GameObjects.Rectangle
  private readonly removeShutdownListener: () => void
  private destroyed = false
  private readonly surfaces = new Map<number, {
    paint: Phaser.GameObjects.Graphics; windows: Phaser.GameObjects.Graphics
    room: Room; art: TiledFloor[]
  }>()

  constructor(scene: Phaser.Scene, layout: NestedLayout) {
    // The mood covers the floor and walls; plates, figures and words keep their contrast.
    this.tint = scene.add.rectangle(0, 0, 1, 1).setScrollFactor(0).setDepth(0.25)
    const floor = undrawnFloor()
    for (const room of roomsToDraw(layout)) {
      const depth = room.depth / 1000
      const paint = scene.add.graphics().setDepth(depth)
      const windows = scene.add.graphics().setDepth(0.5 + depth).setVisible(false)
      this.surfaces.set(room.id, { paint, windows, room, art: [] })
      const { x, y, width, height, door } = room
      for (const rect of roomFloorRects(room)) paint.fillStyle(0x0a1916, 0.35).fillRect(rect.x + 7, rect.y + 9, rect.width, rect.height)
      for (const rect of roomFloorRects(room)) paint.fillStyle(floor.color, 1).fillRect(rect.x, rect.y, rect.width, rect.height)
      for (const cell of curtainCells(room, floor.color)) {
        paint.fillStyle(cell.color).fillRect(cell.x, cell.y, cell.width, cell.height)
      }
      const wall = (x1: number, y1: number, x2: number, y2: number, gap: boolean): void => {
        if (x1 > x2) [x1, x2] = [x2, x1]
        if (y1 > y2) [y1, y2] = [y2, y1]
        if (!gap) { paint.lineBetween(x1, y1, x2, y2); return }
        if (y1 === y2) {
          paint.lineBetween(x1, y1, door.x - 22, y2)
          paint.lineBetween(door.x + 22, y1, x2, y2)
        } else {
          paint.lineBetween(x1, y1, x2, door.y - 22)
          paint.lineBetween(x1, door.y + 22, x2, y2)
        }
      }
      const onTop = !room.quiet && door.y === y
      const onBottom = !room.quiet && door.y === y + height
      const onLeft = !room.quiet && door.x === x
      const onRight = !room.quiet && door.x === x + width
      paint.lineStyle(7, 0x243c30, 1)
      for (const [a, b] of roomOutline(room)) {
        const gap = !room.quiet && (a.y === b.y ? door.y === a.y && door.x >= Math.min(a.x, b.x) && door.x <= Math.max(a.x, b.x)
          : door.x === a.x && door.y >= Math.min(a.y, b.y) && door.y <= Math.max(a.y, b.y))
        wall(a.x, a.y, b.x, b.y, gap)
      }
      paint.lineStyle(2, 0xe2ddaf, 0.8)
      wall(x + 2, y + 2, x + width - 2, y + 2, onTop)
      wall(x + 2, y + 2, x + 2, y + height - 2, onLeft)
      paint.fillStyle(0xe2cc94, 0.65)
      if (onTop || onBottom) paint.fillRect(door.x - 20, door.y - 3, 40, 6)
      else if (onLeft || onRight) paint.fillRect(door.x - 3, door.y - 20, 6, 40)
      // Finished rooms are painted once; only an unfinished founding draws more bricks.
      for (const window of room.quiet ? [] : roomWindows(room)) {
        const { x: wx, y: wy, width: ww, height: wh } = window
        paint.fillStyle(0x142923).fillRect(wx - 2, wy - 2, ww + 4, wh + 4)
        paint.fillStyle(0x607f83).fillRect(wx, wy, ww, wh)
        windows.fillStyle(0xffc769, 0.14).fillRect(wx - 6, wy - 6, ww + 12, wh + 12)
        windows.fillStyle(0xffcf79).fillRect(wx, wy, ww, wh)
        windows.fillStyle(0xffedb0).fillRect(wx + 1, wy + 1, ww - 2, wh - 2)
        if (ww > wh) {
          paint.fillStyle(0x243c30).fillRect(wx + Math.floor(ww / 2), wy, 2, wh)
          windows.fillStyle(0x755638).fillRect(wx + Math.floor(ww / 2), wy, 2, wh)
        } else {
          paint.fillStyle(0x243c30).fillRect(wx, wy + Math.floor(wh / 2), ww, 2)
          windows.fillStyle(0x755638).fillRect(wx, wy + Math.floor(wh / 2), ww, 2)
        }
      }
    }
    this.removeShutdownListener = removableOnce(scene.events, Phaser.Scenes.Events.SHUTDOWN, () => this.destroy())
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.removeShutdownListener()
    this.tint.destroy()
    for (const surface of this.surfaces.values()) {
      surface.paint.destroy(); surface.windows.destroy()
      for (const art of surface.art) art.destroy()
    }
    this.surfaces.clear()
  }

  addDrawing(scene: Phaser.Scene, id: number, drawing: Drawing): void {
    const surface = this.surfaces.get(id)
    const key = `place-${id}`
    if (!surface || surface.room.quiet || surface.art.length) return
    const floor = placeFloorArt(surface.room)
    if (!scene.textures.exists(key)) {
      const paint = scene.make.graphics({ x: 0, y: 0 })
      for (const cell of drawingCells(drawing)) {
        paint.fillStyle(cell.color).fillRect(cell.x * floor.cellSize, cell.y * floor.cellSize, floor.cellSize, floor.cellSize)
      }
      paint.generateTexture(key, floor.tileSize, floor.tileSize)
      paint.destroy()
      scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
    }
    const depth = surface.room.depth / 1000
    surface.art = roomFloorRects(surface.room, 4).map(rect => new TiledFloor(scene, key, rect,
      { x: surface.room.x, y: surface.room.y }, depth + 0.0001, floor.shadeAlpha))
  }

  update(camera: Phaser.Cameras.Scene2D.Camera, recordedTime: number,
    contentsHidden: ReadonlySet<number>): void {
    const mood = daylightAt(recordedTime)
    this.tint.setPosition(camera.width / 2, camera.height / 2)
      .setSize(camera.width / camera.zoom, camera.height / camera.zoom)
      .setFillStyle(mood.color, mood.alpha)
    const lit = windowsLit(recordedTime)
    for (const [id, surface] of this.surfaces) {
      const shown = !contentsHidden.has(id)
      surface.paint.setVisible(shown)
      for (const art of surface.art) art.update(camera, shown)
      surface.windows.setVisible(shown && lit)
    }
  }
}
