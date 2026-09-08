import Phaser from 'phaser'
import { HEART_PIXELS } from '../giving.ts'
import type { stepHandovers, HandoverState, HandoverStep } from '../handovers.ts'
import type { Simulation } from '../replay/simulation.ts'
import { roomFigureStyle } from '../room-appearance.ts'

type Motion = ReturnType<typeof stepHandovers>['motions'][number]

export class HandoverLayer {
  private readonly views = new Map<string, HandoverView>()
  constructor(private readonly scene: Phaser.Scene) {}
  update(frame: HandoverStep | undefined, state: HandoverState | undefined, residents: Simulation | undefined,
    hiddenPlaces: ReadonlySet<number>): void {
    const motions = frame?.motions ?? []; const keys = new Set(motions.map(motion => motion.key))
    for (const [key, view] of this.views) if (!keys.has(key)) { view.destroy(); this.views.delete(key) }
    for (const motion of motions) {
      let view = this.views.get(motion.key)
      if (!view) { view = new HandoverView(this.scene); this.views.set(motion.key, view) }
      const float = state?.floats.find(item => motion.key === `transfer:${item.changeId}`)
      const carry = state?.held.find(item => motion.key === `carry:${item.plan.noticeChangeId}`)
      const carrier = carry ? residents?.residents[carry.plan.carrierId] : undefined
      const placeId = float?.transfer.placeId ?? carrier?.placeId
      const hidden = placeId !== null && placeId !== undefined && hiddenPlaces.has(placeId)
      view.update(hidden ? { ...motion, visible: false } : motion)
    }
  }
  clear(): void { for (const view of this.views.values()) view.destroy(); this.views.clear() }
}

// All timing and positions come from plain functions; this only paints pixels.
export class HandoverView {
  private readonly sprite: Phaser.GameObjects.Image
  private readonly heart: Phaser.GameObjects.Graphics

  constructor(private readonly scene: Phaser.Scene) {
    this.sprite = scene.add.image(0, 0, 'thing-default').setScale(roomFigureStyle('thing').scale).setDepth(104)
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
