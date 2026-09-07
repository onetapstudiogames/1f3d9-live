import Phaser from 'phaser'
import type { NestedLayout, Room } from '../ground/nested.ts'
import { daylightAt, roomWindows, windowsLit } from '../daylight.ts'
import type { Drawing } from '../city/types.ts'
import { drawingCells } from '../city/drawing.ts'
import { curtainCells, roomSignPlacement, roomsToDraw } from '../room-art.ts'

export class RoomView {
  private plates = new Map<number, {
    group: Phaser.GameObjects.Container; text: Phaser.GameObjects.Text; room: Room; nameOffset: number
  }>()
  private readonly tint: Phaser.GameObjects.Rectangle
  private readonly litWindows: Phaser.GameObjects.Graphics

  constructor(scene: Phaser.Scene, layout: NestedLayout) {
    const paint = scene.add.graphics().setDepth(0)
    // The mood covers the floor and walls; plates, figures and words keep their contrast.
    this.tint = scene.add.rectangle(0, 0, 1, 1).setScrollFactor(0).setDepth(0.25)
    this.litWindows = scene.add.graphics().setDepth(0.5).setVisible(false)
    const floors = [0x344d3c, 0x557354, 0x7e9262, 0xb3af7e, 0xc3b58b]
    for (const room of roomsToDraw(layout)) {
      const { x, y, width, height, door } = room
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
      paint.lineStyle(7, 0x243c30, 1)
      wall(x, y, x + width, y, onTop)
      wall(x, y + height, x + width, y + height, onBottom)
      wall(x, y, x, y + height, onLeft)
      wall(x + width, y, x + width, y + height, onRight)
      paint.lineStyle(2, 0xe2ddaf, 0.8)
      wall(x + 2, y + 2, x + width - 2, y + 2, onTop)
      wall(x + 2, y + 2, x + 2, y + height - 2, onLeft)
      paint.fillStyle(0xe2cc94, 0.65)
      if (onTop || onBottom) paint.fillRect(door.x - 20, door.y - 3, 40, 6)
      else if (onLeft || onRight) paint.fillRect(door.x - 3, door.y - 20, 6, 40)
      // Both passes are built once for the whole map, never redrawn as the clock runs.
      for (const window of room.quiet ? [] : roomWindows(room)) {
        const { x: wx, y: wy, width: ww, height: wh } = window
        paint.fillStyle(0x142923).fillRect(wx - 2, wy - 2, ww + 4, wh + 4)
        paint.fillStyle(0x607f83).fillRect(wx, wy, ww, wh)
        this.litWindows.fillStyle(0xffc769, 0.14).fillRect(wx - 6, wy - 6, ww + 12, wh + 12)
        this.litWindows.fillStyle(0xffcf79).fillRect(wx, wy, ww, wh)
        this.litWindows.fillStyle(0xffedb0).fillRect(wx + 1, wy + 1, ww - 2, wh - 2)
        if (ww > wh) {
          paint.fillStyle(0x243c30).fillRect(wx + Math.floor(ww / 2), wy, 2, wh)
          this.litWindows.fillStyle(0x755638).fillRect(wx + Math.floor(ww / 2), wy, 2, wh)
        } else {
          paint.fillStyle(0x243c30).fillRect(wx, wy + Math.floor(wh / 2), ww, 2)
          this.litWindows.fillStyle(0x755638).fillRect(wx, wy + Math.floor(wh / 2), ww, 2)
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

  addDrawing(scene: Phaser.Scene, id: number, drawing: Drawing): void {
    const plate = this.plates.get(id)
    const key = `place-${id}`
    if (!plate || plate.room.quiet || scene.textures.exists(key)) return
    const sign = roomSignPlacement(plate.room)
    const paint = scene.make.graphics({ x: 0, y: 0 })
    for (const cell of drawingCells(drawing)) paint.fillStyle(cell.color).fillRect(cell.x, cell.y, 1, 1)
    paint.generateTexture(key, 8, 8)
    paint.destroy()
    const frame = scene.add.graphics()
      .fillStyle(0xe2ddaf).fillRect(-2, -2, sign.size + 4, sign.size + 4)
      .fillStyle(0x273c30).fillRect(0, 0, sign.size, sign.size)
    const art = scene.add.image(0, 0, key).setOrigin(0).setScale(sign.size / 8)
    plate.group.add([frame, art])
    plate.text.setPosition(sign.nameX - sign.x, sign.nameY - sign.y)
    plate.text.setCrop(0, 0, Math.min(plate.text.width, sign.nameWidth), plate.text.height)
    this.plates.set(id, { ...plate, nameOffset: sign.nameX - sign.x })
  }

  update(camera: Phaser.Cameras.Scene2D.Camera, recordedTime: number): void {
    const mood = daylightAt(recordedTime)
    this.tint.setPosition(camera.width / 2, camera.height / 2)
      .setSize(camera.width / camera.zoom, camera.height / camera.zoom)
      .setFillStyle(mood.color, mood.alpha)
    const lit = windowsLit(recordedTime)
    if (this.litWindows.visible !== lit) this.litWindows.setVisible(lit)
    for (const plate of this.plates.values()) {
      const scale = Math.min(2.5, Math.max(1, 0.85 / camera.zoom))
      plate.group.setScale(scale)
      plate.group.setVisible(plate.room.width * camera.zoom > 105 && plate.room.standing.height * camera.zoom > 27)
      plate.text.setCrop(0, 0, Math.min(plate.text.width, (plate.room.width - 24) / scale - plate.nameOffset), plate.text.height)
    }
  }
}
