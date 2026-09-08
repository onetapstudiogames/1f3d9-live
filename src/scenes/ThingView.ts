import Phaser from 'phaser'
import type { Drawing } from '../city/types.ts'
import { thingDrawingCells, thingParticles } from '../thing-art.ts'
import { effectFrame, type ThingState } from '../things.ts'
import { ROOM_THING_SIZE, roomFigureStyle } from '../room-appearance.ts'
import { NameLabel, type NameLabelBounds } from './NameLabel.ts'

export class ThingView {
  readonly sprite: Phaser.GameObjects.Image
  private readonly glow: Phaser.GameObjects.Image
  private readonly name: NameLabel
  private readonly particles: Phaser.GameObjects.Graphics
  private nameAllowed = false

  constructor(scene: Phaser.Scene) {
    const figureStyle = roomFigureStyle('thing')
    this.glow = scene.add.image(0, 0, 'thing-default').setScale(figureStyle.scale * 1.2).setDepth(89).setTintFill(0xffe6a0).setVisible(false)
    this.sprite = scene.add.image(0, 0, 'thing-default').setScale(figureStyle.scale).setDepth(90).setInteractive()
    this.name = new NameLabel(scene, '', 'thing', 91)
    this.particles = scene.add.graphics().setDepth(92)
  }

  update(thing: ThingState, label: string | null, zoom: number, now: number, carried = false, labelClear = true): void {
    const frame = thing.effect ? effectFrame(thing.effect, now) : null
    const visible = thing.visible && !carried && !frame?.crumbs
    const lift = frame?.puff ? Math.round(12 * (1 - frame.progress)) : 0
    this.sprite.setPosition(thing.x, thing.y - lift).setVisible(visible)
    this.name.setContent(label ?? '', 'thing')
    this.nameAllowed = visible && label !== null && zoom >= 0.55 && labelClear
    this.name.setAllowed(this.nameAllowed)
    this.name.update(thing.x, thing.y + ROOM_THING_SIZE / 2 + 3, zoom, now)
    this.glow.setTexture(this.sprite.texture.key).setPosition(thing.x, thing.y)
      .setVisible(thing.visible && !carried && Boolean(frame?.glow)).setAlpha(frame?.glow ? Math.sin(frame.progress * Math.PI) * 0.75 : 0)
    this.particles.clear().setPosition(thing.x, thing.y).setVisible(thing.visible && !carried)
    if (frame?.puff || frame?.crumbs) {
      for (const cell of thingParticles(frame.puff ? 'puff' : 'crumbs', frame.progress)) {
        this.particles.fillStyle(frame.puff ? 0xffefcd : 0xb78b50, cell.alpha).fillRect(cell.x, cell.y, cell.size, cell.size)
      }
    }
  }

  labelBounds(): NameLabelBounds | null {
    return this.name.bounds()
  }

  setNameVisible(visible: boolean): void {
    this.name.setVisible(this.nameAllowed && visible)
  }

  destroy(): void {
    this.sprite.destroy()
    this.glow.destroy()
    this.name.destroy()
    this.particles.destroy()
  }
}

export function addThingTexture(scene: Phaser.Scene, key: string, drawing: Drawing | null): void {
  if (scene.textures.exists(key)) return
  const paint = scene.make.graphics({ x: 0, y: 0 })
  for (const cell of thingDrawingCells(drawing)) paint.fillStyle(cell.color, 1).fillRect(cell.x, cell.y, 1, 1)
  paint.generateTexture(key, 8, 8)
  scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
  paint.destroy()
}
