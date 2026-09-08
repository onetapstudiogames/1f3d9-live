import Phaser from 'phaser'
import type { Drawing } from '../city/types.ts'
import { thingDrawingCells, thingParticles } from '../thing-art.ts'
import { effectFrame, type ThingState } from '../things.ts'

export class ThingView {
  readonly sprite: Phaser.GameObjects.Image
  private readonly glow: Phaser.GameObjects.Image
  private readonly name: Phaser.GameObjects.Text
  private readonly particles: Phaser.GameObjects.Graphics
  private pointed = false

  constructor(scene: Phaser.Scene) {
    this.glow = scene.add.image(0, 0, 'thing-default').setScale(3.6).setDepth(89).setTintFill(0xffe6a0).setVisible(false)
    this.sprite = scene.add.image(0, 0, 'thing-default').setScale(3).setDepth(90)
      .setInteractive().on('pointerover', () => { this.pointed = true }).on('pointerout', () => { this.pointed = false })
    this.name = scene.add.text(0, 0, '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '13px', color: '#25382c', resolution: 2,
      backgroundColor: '#eadfbd', padding: { x: 3, y: 1 }, fixedWidth: 118, fixedHeight: 36,
      wordWrap: { width: 112, useAdvancedWrap: true }, maxLines: 2,
    }).setOrigin(0.5, 0).setDepth(91)
    this.name.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
    this.particles = scene.add.graphics().setDepth(92)
  }

  update(thing: ThingState, label: string | null, zoom: number, now: number, carried = false, labelClear = true): void {
    const frame = thing.effect ? effectFrame(thing.effect, now) : null
    const visible = thing.visible && !carried && !frame?.crumbs
    const lift = frame?.puff ? Math.round(12 * (1 - frame.progress)) : 0
    this.sprite.setPosition(thing.x, thing.y - lift).setVisible(visible)
    this.name.setText(label ?? '').setPosition(thing.x, thing.y + 17).setScale(1 / zoom)
      .setVisible(visible && label !== null && zoom >= 0.55 && (labelClear || this.pointed))
    this.glow.setTexture(this.sprite.texture.key).setPosition(thing.x, thing.y)
      .setVisible(thing.visible && !carried && Boolean(frame?.glow)).setAlpha(frame?.glow ? Math.sin(frame.progress * Math.PI) * 0.75 : 0)
    this.particles.clear().setPosition(thing.x, thing.y).setVisible(thing.visible && !carried)
    if (frame?.puff || frame?.crumbs) {
      for (const cell of thingParticles(frame.puff ? 'puff' : 'crumbs', frame.progress)) {
        this.particles.fillStyle(frame.puff ? 0xffefcd : 0xb78b50, cell.alpha).fillRect(cell.x, cell.y, cell.size, cell.size)
      }
    }
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
  paint.destroy()
}
