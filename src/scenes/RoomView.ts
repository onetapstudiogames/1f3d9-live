import Phaser from 'phaser'
import type { NestedLayout } from '../ground/nested.ts'

export class RoomView {
  private plates: { text: Phaser.GameObjects.Text; width: number; height: number }[] = []

  constructor(scene: Phaser.Scene, layout: NestedLayout) {
    const paint = scene.add.graphics().setDepth(0)
    const floors = [0x344d3c, 0x557354, 0x7e9262, 0xb3af7e, 0xc3b58b]
    for (const room of Object.values(layout.rooms).sort((a, b) => a.depth - b.depth)) {
      const { x, y, width, height, door } = room
      paint.fillStyle(0x0a1916, 0.35).fillRect(x + 7, y + 9, width, height)
      paint.fillStyle(floors[Math.min(room.depth, floors.length - 1)]!, 1).fillRect(x, y, width, height)
      paint.lineStyle(1, 0xeee5bb, 0.07)
      for (let line = 44; line < Math.min(height, room.standing.height + 52); line += 32) {
        paint.lineBetween(x + 8, y + line, x + width - 8, y + line)
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
      const onTop = door.y === y
      const onBottom = door.y === y + height
      const onLeft = door.x === x
      const onRight = door.x === x + width
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
      else paint.fillRect(door.x - 3, door.y - 20, 6, 40)
      const name = room.name.length > 32 ? `${room.name.slice(0, 31)}…` : room.name
      const text = scene.add.text(x + 12, y + 12, `${name}${room.quiet ? ' · quiet' : ''}`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '15px', color: '#f8edcf',
        backgroundColor: '#273c30', padding: { x: 7, y: 4 },
      }).setDepth(room.depth + 1)
      text.setCrop(0, 0, Math.min(text.width, width - 24), text.height)
      this.plates.push({ text, width, height: room.standing.height })
    }
  }

  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    for (const plate of this.plates) {
      plate.text.setScale(Math.min(2.5, Math.max(1, 0.85 / camera.zoom)))
      plate.text.setVisible(plate.width * camera.zoom > 105 && plate.height * camera.zoom > 27)
    }
  }
}
