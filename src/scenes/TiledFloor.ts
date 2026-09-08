import type Phaser from 'phaser'
import { floorViewport, type FloorRect } from '../floor-viewport.ts'

export class TiledFloor {
  private sprite?: Phaser.GameObjects.TileSprite
  private shade?: Phaser.GameObjects.Rectangle
  private frame?: NonNullable<ReturnType<typeof floorViewport>>
  private readonly scene: Phaser.Scene
  private readonly key: string
  private readonly rect: FloorRect
  private readonly origin: { x: number; y: number }
  private readonly depth: number
  private readonly alpha: number
  constructor(scene: Phaser.Scene, key: string, rect: FloorRect,
    origin: { x: number; y: number }, depth: number, alpha: number) {
    this.scene = scene; this.key = key; this.rect = rect
    this.origin = origin; this.depth = depth; this.alpha = alpha
  }
  update(camera: Phaser.Cameras.Scene2D.Camera, shown: boolean): void {
    const next = shown ? floorViewport(this.rect, camera, 32, this.origin) : null
    if (!next) { this.sprite?.setVisible(false); this.shade?.setVisible(false); return }
    this.sprite ??= this.scene.add.tileSprite(0, 0, 1, 1, this.key).setOrigin(0).setDepth(this.depth)
    this.shade ??= this.scene.add.rectangle(this.rect.x, this.rect.y, this.rect.width, this.rect.height, 0x142722, this.alpha)
      .setOrigin(0).setDepth(this.depth + 0.0001)
    const sprite = this.sprite
    if (sprite.width !== next.pixelWidth || sprite.height !== next.pixelHeight) {
      sprite.setSize(next.pixelWidth, next.pixelHeight)
      ;(sprite as Phaser.GameObjects.TileSprite & { updateCanvas(): void }).updateCanvas()
    }
    // TileSprite copies the source into its own pattern; the source filter is not inherited.
    const renderer = this.scene.game.renderer; const pattern = sprite.fillPattern
    if ('gl' in renderer && pattern && 'webGLTexture' in pattern && pattern.magFilter !== renderer.gl.NEAREST) {
      renderer.setTextureFilter(pattern, 1) // Phaser's NEAREST texture filter.
    }
    sprite.context.imageSmoothingEnabled = false
    sprite.setPosition(next.x, next.y).setDisplaySize(next.width, next.height)
      .setCrop(next.cropX, next.cropY, next.cropWidth, next.cropHeight).setVisible(true)
    if (this.frame?.scale !== next.scale) sprite.setTileScale(next.scale, next.scale)
    if (this.frame?.tileX !== next.tileX || this.frame?.tileY !== next.tileY) sprite.setTilePosition(next.tileX, next.tileY)
    this.shade.setVisible(true); this.frame = next
  }
  destroy(): void { this.sprite?.destroy(); this.shade?.destroy() }
}
