import type Phaser from 'phaser'
import type { Room } from '../ground/nested.ts'
import { seaTiles, seaViewport } from '../sea.ts'

export class SeaView {
  private readonly root: Room
  private readonly sprite: Phaser.GameObjects.TileSprite
  constructor(scene: Phaser.Scene, root: Room) {
    this.root = root
    const key = 'world-sea'
    if (!scene.textures.exists(key)) {
      const paint = scene.make.graphics({ x: 0, y: 0 })
      paint.fillStyle(0x315d68).fillRect(0, 0, 128, 128)
      for (const cell of seaTiles()) paint.fillStyle(cell.color).fillRect(cell.x, cell.y, cell.width, cell.height)
      paint.generateTexture(key, 128, 128); paint.destroy()
    }
    this.sprite = scene.add.tileSprite(0, 0, 1, 1, key).setOrigin(0).setDepth(0.0003)
    scene.events.once('shutdown', () => {
      this.sprite.destroy()
    })
    document.body.dataset['liveSea'] = String(scene.textures.exists(key))
  }
  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    const frame = seaViewport(this.root, camera)
    if (!frame) { this.sprite.setVisible(false); return }
    if (this.sprite.width !== frame.pixelWidth || this.sprite.height !== frame.pixelHeight) {
      this.sprite.setSize(frame.pixelWidth, frame.pixelHeight)
      ;(this.sprite as Phaser.GameObjects.TileSprite & { updateCanvas(): void }).updateCanvas()
    }
    this.sprite.setPosition(frame.x, frame.y).setDisplaySize(frame.width, frame.height)
      .setTileScale(frame.tileScaleX, frame.tileScaleY).setTilePosition(frame.tileX, frame.tileY)
      .setCrop(frame.cropX, frame.cropY, frame.cropWidth, frame.cropHeight).setVisible(true)
  }
}
