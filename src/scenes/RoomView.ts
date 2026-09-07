import Phaser from 'phaser'
import type { NestedLayout, Room } from '../ground/nested.ts'
import { daylightAt, roomWindows, windowsLit } from '../daylight.ts'
import type { Drawing } from '../city/types.ts'
import { drawingCells } from '../city/drawing.ts'
import { curtainCells, placeFloorArt, roomsToDraw } from '../room-art.ts'
import { recordedRoomName, type PlacePlan } from '../places.ts'
import { islandRim, seaTiles } from '../sea.ts'
import {
  animationProgress, brickCount, placeAnimationsByKind, signScale, wallBricks, type PlaceAnimation,
} from '../place-animation.ts'

export class RoomView {
  private plates = new Map<number, {
    group: Phaser.GameObjects.Container; text: Phaser.GameObjects.Text; room: Room; nameOffset: number
  }>()
  private readonly tint: Phaser.GameObjects.Rectangle
  private readonly surfaces = new Map<number, {
    paint: Phaser.GameObjects.Graphics; windows: Phaser.GameObjects.Graphics
    building: Phaser.GameObjects.Graphics | null; bricks: ReturnType<typeof wallBricks>; drawn: number
    art: Phaser.GameObjects.TileSprite | null; shade: Phaser.GameObjects.Rectangle | null; sea: Phaser.GameObjects.Graphics | null
  }>()

  constructor(scene: Phaser.Scene, layout: NestedLayout, private plan: PlacePlan) {
    // The mood covers the floor and walls; plates, figures and words keep their contrast.
    this.tint = scene.add.rectangle(0, 0, 1, 1).setScrollFactor(0).setDepth(0.25)
    const floors = [0x344d3c, 0x557354, 0x7e9262, 0xb3af7e, 0xc3b58b]
    document.body.dataset['liveSea'] = 'true'
    for (const room of roomsToDraw(layout)) {
      const depth = room.depth / 1000
      const paint = scene.add.graphics().setDepth(depth)
      const windows = scene.add.graphics().setDepth(0.5 + depth).setVisible(false)
      const bricks = plan.foundings.has(room.id) ? wallBricks(room) : []
      const building = bricks.length ? scene.add.graphics().setDepth(depth).setVisible(false) : null
      const sea = room.id === layout.rootId
        ? scene.add.graphics().setDepth(depth + 0.0003)
        : null
      if (sea) {
        sea.fillStyle(0x315d68).fillRect(room.x + 4, room.y + 4, room.width - 8, room.height - 8)
        for (let y = room.y + 4; y < room.y + room.height - 4; y += 128) {
          for (let x = room.x + 4; x < room.x + room.width - 4; x += 128) for (const cell of seaTiles()) {
            sea.fillStyle(cell.color).fillRect(x + cell.x, y + cell.y, cell.width, cell.height)
          }
        }
      }
      this.surfaces.set(room.id, { paint, windows, building, bricks, drawn: -1, art: null, shade: null, sea })
      const { x, y, width, height, door } = room
      if (room.parentId === layout.rootId) for (const rim of islandRim(room)) {
        paint.fillStyle(rim.color).fillRect(rim.x, rim.y, rim.width, rim.height)
      }
      paint.fillStyle(0x0a1916, 0.35).fillRect(x + 7, y + 9, width, height)
      const floorColor = floors[Math.min(room.depth, floors.length - 1)]!
      paint.fillStyle(floorColor, 1).fillRect(x, y, width, height)
      paint.lineStyle(1, 0xeee5bb, 0.07)
      for (let line = 44; !room.quiet && line < Math.min(height, room.standing.height + 52); line += 32) {
        paint.lineBetween(x + 8, y + line, x + width - 8, y + line)
      }
      for (const cell of curtainCells(room, floorColor)) {
        paint.fillStyle(cell.color).fillRect(cell.x, cell.y, cell.width, cell.height)
      }
      const wall = (x1: number, y1: number, x2: number, y2: number, gap: boolean): void => {
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
      if (bricks.length) {
        for (const brick of bricks) paint.fillStyle(brick.color).fillRect(brick.x, brick.y, brick.width, brick.height)
      } else {
        paint.lineStyle(7, 0x243c30, 1)
        wall(x, y, x + width, y, onTop)
        wall(x, y + height, x + width, y + height, onBottom)
        wall(x, y, x, y + height, onLeft)
        wall(x + width, y, x + width, y + height, onRight)
        paint.lineStyle(2, 0xe2ddaf, 0.8)
        wall(x + 2, y + 2, x + width - 2, y + 2, onTop)
        wall(x + 2, y + 2, x + 2, y + height - 2, onLeft)
      }
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
      const name = room.name.length > 32 ? `${room.name.slice(0, 31)}…` : room.name
      const text = scene.add.text(0, 0, name, {
        fontFamily: 'system-ui, sans-serif', fontSize: '15px', color: '#f8edcf',
        backgroundColor: '#273c30', padding: { x: 7, y: 4 },
      })
      text.setCrop(0, 0, Math.min(text.width, width - 24), text.height)
      const group = scene.add.container(x + 12, y + 12, [text]).setDepth(room.depth + 1)
      this.plates.set(room.id, { group, text, room, nameOffset: 0 })
    }
  }

  setPlan(plan: PlacePlan): void { this.plan = plan }

  addDrawing(scene: Phaser.Scene, id: number, drawing: Drawing): void {
    const plate = this.plates.get(id)
    const surface = this.surfaces.get(id)
    const key = `place-${id}`
    if (!plate || !surface || surface.sea || plate.room.quiet || scene.textures.exists(key)) return
    const floor = placeFloorArt(plate.room)
    const paint = scene.make.graphics({ x: 0, y: 0 })
    for (const cell of drawingCells(drawing)) {
      paint.fillStyle(cell.color).fillRect(cell.x * floor.cellSize, cell.y * floor.cellSize, floor.cellSize, floor.cellSize)
    }
    paint.generateTexture(key, floor.tileSize, floor.tileSize)
    paint.destroy()
    const depth = plate.room.depth / 1000
    surface.art = scene.add.tileSprite(floor.x, floor.y, floor.width, floor.height, key).setOrigin(0)
      .setTilePosition(floor.tileOffsetX, floor.tileOffsetY).setDepth(depth + 0.0001).setVisible(false)
    surface.shade = scene.add.rectangle(floor.x, floor.y, floor.width, floor.height, 0x142722, floor.shadeAlpha)
      .setOrigin(0).setDepth(depth + 0.0002).setVisible(false)
  }

  update(camera: Phaser.Cameras.Scene2D.Camera, recordedTime: number, now: number,
    hidden: ReadonlySet<number>, contentsHidden: ReadonlySet<number>, animations: readonly PlaceAnimation[]): void {
    const mood = daylightAt(recordedTime)
    this.tint.setPosition(camera.width / 2, camera.height / 2)
      .setSize(camera.width / camera.zoom, camera.height / camera.zoom)
      .setFillStyle(mood.color, mood.alpha)
    const lit = windowsLit(recordedTime)
    const active = placeAnimationsByKind(animations)
    for (const plate of this.plates.values()) {
      const id = plate.room.id
      const surface = this.surfaces.get(id)!
      const animation = active.get(id)
      const founding = animation?.founding ?? null
      const shown = !contentsHidden.has(id)
      surface.paint.setVisible(shown)
      surface.sea?.setVisible(shown)
      surface.art?.setVisible(shown)
      surface.shade?.setVisible(shown)
      surface.windows.setVisible(shown && lit)
      if (surface.building) {
        // The parent floor stays bare until this row is due. Children wait for the parent walls.
        const parentBuilding = plate.room.parentId !== null && contentsHidden.has(plate.room.parentId)
        surface.building.setVisible(Boolean(founding) && !hidden.has(id) && !parentBuilding)
        if (founding) this.drawFounding(plate.room, surface, animationProgress(founding, now))
      }
      const fullName = recordedRoomName(this.plan, plate.room, recordedTime)
      const name = fullName && fullName.length > 32 ? `${fullName.slice(0, 31)}…` : fullName ?? ''
      if (plate.text.text !== name) plate.text.setText(name)
      const scale = Math.min(2.5, Math.max(1, 0.85 / camera.zoom))
      plate.group.setScale(scale)
      plate.text.setScale(animation?.renaming ? signScale(animationProgress(animation.renaming, now)) : 1, 1)
      plate.group.setVisible(shown && plate.room.width * camera.zoom > 105 && plate.room.standing.height * camera.zoom > 27)
      plate.text.setCrop(0, 0, Math.min(plate.text.width, (plate.room.width - 24) / scale - plate.nameOffset), plate.text.height)
    }
  }

  private drawFounding(room: Room, surface: {
    building: Phaser.GameObjects.Graphics | null; bricks: ReturnType<typeof wallBricks>; drawn: number
  }, progress: number): void {
    const count = brickCount(surface.bricks.length, progress)
    if (!surface.building || surface.drawn === count) return
    const paint = surface.building
    if (surface.drawn < 0) {
      const floors = [0x344d3c, 0x557354, 0x7e9262, 0xb3af7e, 0xc3b58b]
      paint.fillStyle(floors[Math.min(room.depth, floors.length - 1)]!).fillRect(room.x, room.y, room.width, room.height)
    }
    for (const brick of surface.bricks.slice(Math.max(0, surface.drawn), count)) {
      paint.fillStyle(brick.color).fillRect(brick.x, brick.y, brick.width, brick.height)
    }
    surface.drawn = count
  }
}
