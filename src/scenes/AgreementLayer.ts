import Phaser from 'phaser'
import { handshakeFrame, type StartedHandshake } from '../agreements.ts'
import type { ResidentView } from './ResidentView.ts'
import type { Point } from '../ground/nested.ts'
import { visibleFigureMidpoint } from '../room-anchors.ts'
import { roomTextResolution } from '../room-appearance.ts'
import { RESIDENT_HAND_RECTS, residentGlyphDistance, residentOverlayDistance } from '../resident-overlays.ts'

type View = Readonly<{ hands: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text }>

export class AgreementLayer {
  private active: readonly StartedHandshake[] = []
  private readonly views = new Map<string, View>()
  add(started: readonly StartedHandshake[]): void { this.active = Object.freeze([...this.active, ...started]) }
  snapshot(): readonly StartedHandshake[] { return this.active }
  restore(active: readonly StartedHandshake[]): void { this.active = active; this.frames = [] }

  private frames: readonly { active: StartedHandshake; frame: NonNullable<ReturnType<typeof handshakeFrame>> }[] = []
  project(now: number): ReadonlyMap<number, Point> {
    const remaining: StartedHandshake[] = []; const positions = new Map<number, Point>(); const frames = []
    for (const active of this.active) {
      const frame = handshakeFrame(active.plan, now); if (!frame) continue
      remaining.push(active); frames.push({ active, frame }); positions.set(active.plan.leftId, frame.left); positions.set(active.plan.rightId, frame.right)
    }
    this.active = Object.freeze(remaining); this.frames = Object.freeze(frames)
    return positions
  }
  draw(scene: Phaser.Scene, figures: ReadonlyMap<number, ResidentView>, hiddenPlaces: ReadonlySet<number>): void {
    const remaining: StartedHandshake[] = []; const keys = new Set<string>()
    for (const { active, frame } of this.frames) {
      remaining.push(active); const key = active.plan.signature.changeId; keys.add(key)
      let view = this.views.get(key)
      if (!view) {
        view = Object.freeze({ hands: scene.add.graphics().setDepth(206), label: scene.add.text(0, 0,
          `agreement #${active.plan.signature.agreementId}`, { fontFamily: 'monospace', fontSize: '12px', color: '#21392e',
            backgroundColor: '#fff3d6', padding: { x: 4, y: 2 }, resolution: roomTextResolution(window.devicePixelRatio) })
          .setOrigin(0.5, 1).setDepth(206) })
        view.label.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
        this.views.set(key, view)
      }
      const left = figures.get(active.plan.leftId)?.sprite; const right = figures.get(active.plan.rightId)?.sprite
      const midpoint = visibleFigureMidpoint(left, right)
      const hidden = hiddenPlaces.has(active.plan.placeId) || midpoint === null
      view.hands.clear().setVisible(frame.hands && !hidden)
      if (frame.hands) for (const cell of RESIDENT_HAND_RECTS) view.hands.fillStyle(cell.color, cell.alpha)
        .fillRect(cell.x, cell.y + residentGlyphDistance(frame.shake), cell.width, cell.height)
      const x = midpoint?.x ?? 0; const y = midpoint?.y ?? 0
      const resolution = roomTextResolution(window.devicePixelRatio)
      if (view.label.style.resolution !== resolution) view.label.setResolution(resolution)
      view.hands.setPosition(x, y + residentOverlayDistance(-4))
      view.label.setPosition(x, y + residentOverlayDistance(-18)).setVisible(frame.hands && !hidden)
    }
    for (const [key, view] of this.views) if (!keys.has(key)) { view.hands.destroy(); view.label.destroy(); this.views.delete(key) }
  }

  clear(): void { this.active = []; this.frames = []; for (const view of this.views.values()) { view.hands.destroy(); view.label.destroy() } this.views.clear() }
  get count(): number { return this.active.length }
}
