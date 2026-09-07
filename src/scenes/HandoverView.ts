import Phaser from 'phaser'
import { HEART_PIXELS } from '../giving.ts'
import type { stepHandovers } from '../handovers.ts'

type Motion = ReturnType<typeof stepHandovers>['motions'][number]

// All timing and positions come from plain functions; this only paints pixels.
export class HandoverView {
  private readonly sprite: Phaser.GameObjects.Image
  private readonly heart: Phaser.GameObjects.Graphics

  constructor(private readonly scene: Phaser.Scene) {
    this.sprite = scene.add.image(0, 0, 'thing-default').setScale(3).setDepth(104)
    this.heart = scene.add.graphics().setDepth(105)
  }

  update(motion: Motion): void {
    const texture = `thing-${motion.thingId}`
    this.sprite.setTexture(this.scene.textures.exists(texture) ? texture : 'thing-default')
      .setPosition(motion.x, motion.y).setAlpha(motion.alpha).setVisible(motion.visible)
    this.heart.clear().setVisible(motion.visible && Boolean(motion.heart))
    if (motion.heart) {
      this.heart.setPosition(motion.heart.x, motion.heart.y)
      for (const pixel of HEART_PIXELS) {
        this.heart.fillStyle(0xd65b70, motion.alpha).fillRect(pixel.x * 2, pixel.y * 2, 2, 2)
      }
    }
  }

  destroy(): void {
    this.sprite.destroy()
    this.heart.destroy()
  }
}
