import Phaser from 'phaser'
import type { Drawing } from '../city/types.ts'
import { drawingCells } from '../city/drawing.ts'
import { sleepingDrawingCells } from '../sleep.ts'
import { residentNamePlate } from '../city/residents.ts'
import type { ResidentState } from '../replay/simulation.ts'

export class ResidentView {
  readonly sprite: Phaser.GameObjects.Image
  private readonly name: Phaser.GameObjects.Text
  private readonly bubble: Phaser.GameObjects.Text
  private readonly zzz: Phaser.GameObjects.Graphics
  private readonly named: boolean
  private standingTexture = 'resident-default'

  constructor(scene: Phaser.Scene, resident: ResidentState) {
    const plate = residentNamePlate(resident.handle)
    this.named = plate !== null
    this.sprite = scene.add.image(resident.x, resident.y, 'resident-default')
      .setScale(4).setDepth(100).setInteractive({ useHandCursor: true }).setData('residentId', resident.id)
    this.name = scene.add.text(0, 0, plate ?? '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#172c24',
      backgroundColor: '#e9dfb9', padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 0).setDepth(101)
    this.bubble = scene.add.text(0, 0, '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#21392e',
      backgroundColor: '#fff3d6', padding: { x: 12, y: 9 },
      wordWrap: { width: 230, useAdvancedWrap: true },
    }).setOrigin(0.5, 1).setDepth(200).setVisible(false)
    this.zzz = scene.add.graphics().setDepth(102).setVisible(false)
    this.zzz.fillStyle(0xe9dfb9, 1)
    for (const [x, y] of [[0, 0], [6, -7], [12, -14]] as const) {
      this.zzz.fillRect(x, y, 6, 2).fillRect(x + 2, y + 2, 2, 2).fillRect(x, y + 4, 6, 2)
    }
  }

  update(resident: ResidentState, zoom: number, now: number, followed: boolean, asleep = false): void {
    const currentTexture = this.sprite.texture.key
    if (!currentTexture.endsWith('-asleep')) this.standingTexture = currentTexture
    const sleeping = asleep && !resident.walking && resident.bubble === null
    const texture = sleeping && this.sprite.scene.textures.exists(`${this.standingTexture}-asleep`)
      ? `${this.standingTexture}-asleep` : this.standingTexture
    if (this.sprite.texture.key !== texture) this.sprite.setTexture(texture)
    const bob = resident.walking ? Math.sin(now / 90) * 2 : 0
    this.sprite.setPosition(resident.x, resident.y + bob).setFlipX(resident.flipX).setVisible(resident.visible)
    this.name.setPosition(resident.x, resident.y + (sleeping ? 19 : 22)).setVisible(this.named && resident.visible && (zoom >= 0.45 || followed))
    this.zzz.setPosition(resident.x + 13, resident.y - 13).setVisible(sleeping && resident.visible)
    const bubble = resident.bubble
    this.bubble.setVisible(resident.visible && bubble !== null)
    if (bubble) {
      this.bubble.setText(`${bubble.text}${bubble.cut ? '\n[recorded excerpt]' : ''}`)
      this.bubble.setScale(Math.min(4, Math.max(1, 0.8 / zoom))).setPosition(resident.x, resident.y - 25)
    }
  }
}

export function addDrawingTexture(scene: Phaser.Scene, key: string, drawing: Drawing | null): void {
  if (scene.textures.exists(key)) return
  const cells = drawingCells(drawing)
  const paint = scene.make.graphics({ x: 0, y: 0 })
  for (const cell of cells) paint.fillStyle(cell.color, 1).fillRect(cell.x, cell.y, 1, 1)
  paint.generateTexture(key, 8, 8)
  paint.clear()
  for (const cell of sleepingDrawingCells(drawing)) paint.fillStyle(cell.color, 1).fillRect(cell.x, cell.y, 1, 1)
  paint.generateTexture(`${key}-asleep`, 8, 8)
  paint.destroy()
}
