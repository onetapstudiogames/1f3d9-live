import Phaser from 'phaser'
import { labelContent, marqueeOffset, NAME_LABEL } from '../name-label.ts'
import { roomTextResolution } from '../room-appearance.ts'

export type NameLabelBounds = Readonly<{ x: number; y: number; width: number; height: number }>

export class NameLabel {
  private readonly card: Phaser.GameObjects.Graphics
  private readonly clipShape: Phaser.GameObjects.Graphics
  private readonly clip: Phaser.Display.Masks.GeometryMask
  private readonly text: Phaser.GameObjects.Text
  private readonly kind: Phaser.GameObjects.Text
  private name: string
  private kindName: string | null
  private allowed = false
  private shown = true
  private scrolling = false
  private showKind = false
  private anchorX = 0
  private anchorY = 0
  private zoom = 1

  constructor(scene: Phaser.Scene, name: string, kind: string | null = null, depth = 101) {
    this.name = name
    this.kindName = kind
    this.card = scene.add.graphics().setDepth(depth)
    this.card.fillStyle(0x3a2f25, 0.16).fillRoundedRect(-NAME_LABEL.width / 2 + 1, 2,
      NAME_LABEL.width, NAME_LABEL.height, 6)
    this.card.fillStyle(0xfff4d8, 0.97).fillRoundedRect(-NAME_LABEL.width / 2, 0,
      NAME_LABEL.width, NAME_LABEL.height, 6)
    this.clipShape = scene.make.graphics({ x: 0, y: 0 })
    this.clipShape.fillStyle(0xffffff, 1).fillRect(-NAME_LABEL.textWidth / 2, 0,
      NAME_LABEL.textWidth, NAME_LABEL.height)
    this.clip = this.clipShape.createGeometryMask()
    this.text = scene.add.text(0, 0, name, {
      fontFamily: 'system-ui, sans-serif', fontSize: `${NAME_LABEL.fontSize}px`, color: '#534b3b',
      resolution: roomTextResolution(window.devicePixelRatio),
    }).setOrigin(0, 0.5).setDepth(depth + 0.1).setMask(this.clip)
    this.text.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
    this.kind = scene.add.text(0, 0, kind ?? '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '9px', color: '#8a7256',
      resolution: roomTextResolution(window.devicePixelRatio),
    }).setOrigin(0, 0.5).setDepth(depth + 0.1).setMask(this.clip)
    this.kind.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
    this.refreshLayout()
    this.setVisible(false)
  }

  setContent(name: string, kind: string | null = this.kindName): void {
    if (name === this.name && kind === this.kindName) return
    if (name !== this.name) this.text.setText(name)
    if (kind !== this.kindName) this.kind.setText(kind ?? '')
    this.name = name
    this.kindName = kind
    this.refreshLayout()
  }

  update(x: number, y: number, zoom: number, elapsedMs: number): void {
    this.anchorX = x
    this.anchorY = y
    this.zoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
    const scale = 1 / this.zoom
    const resolution = roomTextResolution(window.devicePixelRatio)
    if (this.text.style.resolution !== resolution) {
      this.text.setResolution(resolution)
      this.kind.setResolution(resolution)
      this.refreshLayout()
    }
    this.card.setPosition(x, y).setScale(scale)
    this.clipShape.setPosition(x, y).setScale(scale)
    const left = x - NAME_LABEL.textWidth * scale / 2
    const centerY = y + NAME_LABEL.height * scale / 2
    if (this.scrolling) {
      this.text.setPosition(left + marqueeOffset(this.text.width, elapsedMs) * scale, centerY).setScale(scale)
    } else {
      const kindWidth = this.showKind ? this.kind.width : 0
      const totalWidth = this.text.width + (kindWidth > 0 ? kindWidth + 5 : 0)
      const start = x - totalWidth * scale / 2
      this.text.setPosition(start, centerY).setScale(scale)
      this.kind.setPosition(start + (this.text.width + 5) * scale, centerY).setScale(scale)
    }
  }

  setAllowed(allowed: boolean): void {
    this.allowed = allowed
    this.applyVisibility()
  }

  setVisible(visible: boolean): void {
    this.shown = visible
    this.applyVisibility()
  }

  setAlpha(alpha: number): void {
    this.card.setAlpha(alpha)
    this.text.setAlpha(alpha)
    this.kind.setAlpha(alpha)
  }

  bounds(): NameLabelBounds | null {
    if (!this.allowed) return null
    const scale = 1 / this.zoom
    return Object.freeze({ x: this.anchorX - NAME_LABEL.width * scale / 2, y: this.anchorY,
      width: NAME_LABEL.width * scale, height: NAME_LABEL.height * scale })
  }

  destroy(): void {
    this.text.destroy()
    this.kind.destroy()
    this.clip.destroy()
    this.clipShape.destroy()
    this.card.destroy()
  }

  private refreshLayout(): void {
    const policy = labelContent(this.name, this.kindName, this.text.width, this.kind.width)
    this.scrolling = policy.scroll
    this.showKind = policy.showKind
    this.kind.setVisible(policy.showKind && this.allowed && this.shown)
  }

  private applyVisibility(): void {
    const visible = this.allowed && this.shown
    this.card.setVisible(visible)
    this.text.setVisible(visible)
    const policy = labelContent(this.name, this.kindName, this.text.width, this.kind.width)
    this.showKind = policy.showKind
    this.kind.setVisible(visible && this.showKind)
  }
}
