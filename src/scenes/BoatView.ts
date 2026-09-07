import type Phaser from 'phaser'
import type { BoatFrame, PixelRect } from '../sea.ts'

export class BoatView {
  private readonly scene: Phaser.Scene
  private hull: Phaser.GameObjects.Graphics | null = null
  private sail: Phaser.GameObjects.Graphics | null = null
  constructor(scene: Phaser.Scene) { this.scene = scene }
  update(frame: BoatFrame | null): void {
    if (!frame) { this.hull?.setVisible(false); this.sail?.setVisible(false); return }
    if (!this.hull || !this.sail) {
      this.sail = this.draw(frame.sail, 99)
      this.hull = this.draw(frame.hull, 100.5)
    }
    for (const layer of [this.sail, this.hull]) layer.setPosition(frame.x, frame.y + frame.bob)
      .setScale(frame.flipX ? -1 : 1, 1).setVisible(true)
  }
  destroy(): void { this.hull?.destroy(); this.sail?.destroy(); this.hull = null; this.sail = null }
  private draw(cells: readonly PixelRect[], depth: number): Phaser.GameObjects.Graphics {
    const graphics = this.scene.add.graphics().setDepth(depth)
    for (const cell of cells) graphics.fillStyle(cell.color).fillRect(cell.x, cell.y, cell.width, cell.height)
    return graphics
  }
}
