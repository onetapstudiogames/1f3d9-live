import Phaser from 'phaser'
import { roomCanvasSizing, type RoomCanvasSizing } from '../room-canvas.ts'

export class RoomCanvas {
  frame: RoomCanvasSizing
  private readonly observer: ResizeObserver

  constructor(private readonly scene: Phaser.Scene, private readonly changed: () => void) {
    this.frame = roomCanvasSizing(0, 0, 1)
    this.observer = new ResizeObserver(this.resize)
    this.observer.observe(document.getElementById('app')!)
    window.addEventListener('resize', this.resize)
    this.resize()
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.observer.disconnect()
      window.removeEventListener('resize', this.resize)
    })
  }

  private readonly resize = (): void => {
    const app = document.getElementById('app')!
    const next = roomCanvasSizing(app.clientWidth, app.clientHeight, window.devicePixelRatio)
    if (next.width === this.frame.width && next.height === this.frame.height && next.zoom === this.frame.zoom) return
    this.frame = next
    const { width, height, backingWidth, backingHeight, zoom, scrollX, scrollY } = next
    if (this.scene.scale.zoom !== 1 / zoom) this.scene.scale.setZoom(1 / zoom)
    this.scene.scale.resize(backingWidth, backingHeight)
    this.scene.game.canvas.style.width = `${width}px`
    this.scene.game.canvas.style.height = `${height}px`
    // Keep fractional compensation: flooring scroll would shift odd-sized rooms.
    this.scene.cameras.main.setRoundPixels(false).setViewport(0, 0, backingWidth, backingHeight)
      .setZoom(zoom).setScroll(scrollX, scrollY)
    this.changed()
  }
}
