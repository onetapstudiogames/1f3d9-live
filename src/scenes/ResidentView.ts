import Phaser from 'phaser'
import type { Drawing, ReplayPlace } from '../city/types.ts'
import { drawingCells } from '../city/drawing.ts'
import { sleepingDrawingCells } from '../sleep.ts'
import { residentNamePlate } from '../city/residents.ts'
import type { ResidentState } from '../replay/simulation.ts'
import { isNewResident, sparkleAlpha } from '../newcomers.ts'
import { bubbleRects, bubbleShape, typedBubbleFrame } from '../speech.ts'
import { ballotCells, confettiCells, showingFor, showingFrame, spotlightCells } from '../showing.ts'
import { lockCells } from '../laws.ts'
import { boatFrame } from '../sea.ts'
import type { NestedLayout } from '../ground/nested.ts'
import { BoatView } from './BoatView.ts'

export type VisibleSpeech = Readonly<{ residentId: number; text: string; shape: string; showing: string }>

export class ResidentView {
  readonly sprite: Phaser.GameObjects.Image
  private readonly name: Phaser.GameObjects.Text
  private readonly bubble: Phaser.GameObjects.Text
  private readonly bubbleBackground: Phaser.GameObjects.Graphics
  private readonly bubbleCut: Phaser.GameObjects.Text
  private readonly zzz: Phaser.GameObjects.Graphics
  private readonly newTag: Phaser.GameObjects.Text
  private readonly sparkle: Phaser.GameObjects.Graphics
  private showing: Phaser.GameObjects.Graphics | null = null
  private contest: Phaser.GameObjects.Graphics | null = null
  private lock: Phaser.GameObjects.Graphics | null = null
  private lockLabel: Phaser.GameObjects.Text | null = null
  private readonly boat: BoatView
  private readonly named: boolean
  private standingTexture = 'resident-default'

  constructor(scene: Phaser.Scene, resident: ResidentState) {
    this.boat = new BoatView(scene)
    const plate = residentNamePlate(resident.handle)
    this.named = plate !== null
    this.sprite = scene.add.image(resident.x, resident.y, 'resident-default')
      .setScale(4).setDepth(100).setInteractive({ useHandCursor: true }).setData('residentId', resident.id)
    this.name = scene.add.text(0, 0, plate ?? '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#172c24',
      backgroundColor: '#e9dfb9', padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 0).setDepth(101)
    this.newTag = scene.add.text(0, 0, 'new', {
      fontFamily: 'monospace', fontSize: '12px', color: '#203c2b',
      backgroundColor: '#ffe69a', padding: { x: 3, y: 2 },
    }).setOrigin(0, 0).setDepth(102).setVisible(false)
    this.sparkle = scene.add.graphics().setDepth(102).setVisible(false)
    this.sparkle.fillStyle(0xffe69a, 1)
    for (const [x, y] of [[-25, -10], [21, -19], [18, 13]] as const) {
      this.sparkle.fillRect(x, y - 3, 3, 9).fillRect(x - 3, y, 9, 3)
    }
    this.bubbleBackground = scene.add.graphics().setDepth(199).setVisible(false)
    this.bubble = scene.add.text(0, 0, '', {
      fontFamily: 'monospace', fontSize: '14px', color: '#21392e',
      padding: { x: 10, y: 7 }, fixedWidth: 230, fixedHeight: 82,
    }).setOrigin(0.5, 1).setDepth(200).setVisible(false)
    this.bubbleCut = scene.add.text(0, 0, '[recorded excerpt]', { fontFamily: 'monospace', fontSize: '11px',
      color: '#6c5838' }).setOrigin(0.5, 1).setDepth(200).setVisible(false)
    this.zzz = scene.add.graphics().setDepth(102).setVisible(false)
    this.zzz.fillStyle(0xe9dfb9, 1)
    for (const [x, y] of [[0, 0], [6, -7], [12, -14]] as const) {
      this.zzz.fillRect(x, y, 6, 2).fillRect(x + 2, y + 2, 2, 2).fillRect(x, y + 4, 6, 2)
    }
  }

  update(resident: ResidentState, zoom: number, now: number, followed: boolean, asleep = false,
    recordedTime = Number.NaN, places: readonly ReplayPlace[] = [], layout?: NestedLayout): VisibleSpeech | null {
    const currentTexture = this.sprite.texture.key
    if (!currentTexture.endsWith('-asleep')) this.standingTexture = currentTexture
    const sleeping = asleep && !resident.walking && resident.bubble === null
    const texture = sleeping && this.sprite.scene.textures.exists(`${this.standingTexture}-asleep`)
      ? `${this.standingTexture}-asleep` : this.standingTexture
    if (this.sprite.texture.key !== texture) this.sprite.setTexture(texture)
    const sailing = layout && resident.walking && resident.walkEventId
      ? boatFrame(layout, resident.path, resident.pathProgress ?? 0, resident.visible) : null
    this.boat.update(sailing)
    const bob = sailing ? sailing.bob : resident.walking ? Math.sin(now / 90) * 2 : 0
    this.sprite.setPosition(resident.x, resident.y + bob).setFlipX(resident.flipX).setVisible(resident.visible)
    this.name.setPosition(resident.x, resident.y + (sleeping ? 19 : 22)).setVisible(this.named && resident.visible && (zoom >= 0.45 || followed))
    this.newTag.setPosition(this.name.x + (this.named ? this.name.width / 2 + 3 : 0), this.name.y)
      .setVisible(resident.visible && (zoom >= 0.45 || followed) && isNewResident(resident.joinedAt, recordedTime))
    const alpha = sparkleAlpha(resident.sparkle, now)
    this.sparkle.setPosition(resident.x, resident.y).setAlpha(alpha).setVisible(resident.visible && alpha > 0)
    this.zzz.setPosition(resident.x + 13, resident.y - 13).setVisible(sleeping && resident.visible)
    const blocked = resident.visible ? resident.blockedAttempt : null
    if (blocked) {
      this.lock ??= this.sprite.scene.add.graphics().setDepth(204)
      this.lockLabel ??= this.sprite.scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', color: '#3a201f',
        backgroundColor: '#f1c7b7', padding: { x: 3, y: 2 } }).setDepth(204).setOrigin(0.5, 1)
      this.lock.clear().setPosition(resident.x - 5, resident.y - 54)
      for (const cell of lockCells()) this.lock.fillStyle(cell.color).fillRect(cell.x, cell.y, cell.width, cell.height)
      this.lockLabel.setText(`blocked ${blocked.attempt.action}`).setPosition(resident.x, resident.y - 58)
    } else if (this.lock || this.lockLabel) {
      this.lock?.destroy(); this.lockLabel?.destroy(); this.lock = null; this.lockLabel = null
    }
    const bubble = resident.bubble
    const moment = showingFor(bubble, resident.visible, places, resident.handle)
      ?? (resident.visible ? resident.showingNotice ?? null : null)
    const contest = moment ? showingFrame(moment, now) : null
    if (contest) {
      this.showing ??= this.sprite.scene.add.graphics().setDepth(99)
      this.contest ??= this.sprite.scene.add.graphics().setDepth(204)
      this.showing.clear(); this.contest.clear()
      this.showing.setPosition(resident.x, resident.y)
      for (const cell of spotlightCells()) this.showing.fillStyle(cell.color, cell.alpha * contest.alpha)
        .fillRect(cell.x, cell.y, cell.width, cell.height)
      this.contest.setPosition(resident.x, resident.y)
      if (contest.ballotY !== null) for (const [index, cell] of ballotCells().entries()) this.contest.fillStyle(cell.color, cell.alpha)
        .fillRect(cell.x, cell.y + (index < 2 ? contest.ballotY : 0), cell.width, cell.height)
      if (contest.confetti) for (const cell of confettiCells()) this.contest.fillStyle(cell.color, contest.confetti)
        .fillRect(cell.x, cell.y + Math.round(contest.confetti * 12), cell.width, cell.height)
    } else if (this.showing || this.contest) {
      this.showing?.destroy(); this.contest?.destroy(); this.showing = null; this.contest = null
    }
    this.bubble.setVisible(resident.visible && bubble !== null)
    this.bubbleBackground.setVisible(resident.visible && bubble !== null)
    this.bubbleCut.setVisible(false)
    if (bubble && resident.visible) {
      this.bubble.style.syncFont(this.bubble.canvas, this.bubble.context)
      const frame = typedBubbleFrame(bubble, now, 210, 4, text => this.bubble.context.measureText(text).width)
      const shape = bubbleShape(bubble.placeId, places)
      const scale = Math.min(4, Math.max(1, 0.8 / zoom)); const x = resident.x; const y = resident.y - 25
      const showCut = frame.complete && frame.cut; const height = showCut ? 102 : 82
      this.bubble.setText(frame.text).setScale(scale).setPosition(x, y - (showCut ? 20 * scale : 0))
      this.bubbleCut.setScale(scale).setPosition(x, y - 3 * scale).setVisible(showCut)
      this.bubbleBackground.clear()
      for (const cell of bubbleRects(shape, 230, height)) {
        this.bubbleBackground.fillStyle(cell.color, cell.alpha).fillRect(cell.x - 115, cell.y - height, cell.width, cell.height)
      }
      this.bubbleBackground.setScale(scale).setPosition(x, y)
      return Object.freeze({ residentId: resident.id, text: frame.revealed, shape,
        showing: moment?.confetti ? 'confetti' : moment?.ballot ? 'ballot' : moment ? 'spotlight' : '' })
    }
    return null
  }

  destroy(): void {
    this.sprite.destroy()
    this.name.destroy()
    this.bubble.destroy()
    this.bubbleBackground.destroy()
    this.bubbleCut.destroy()
    this.zzz.destroy()
    this.newTag.destroy()
    this.sparkle.destroy()
    this.showing?.destroy()
    this.contest?.destroy()
    this.lock?.destroy()
    this.lockLabel?.destroy()
    this.boat.destroy()
  }
}

export function addDrawingTexture(scene: Phaser.Scene, key: string, drawing: Drawing | null): void {
  if (scene.textures.exists(key)) return
  const cells = drawingCells(drawing)
  const paint = scene.make.graphics({ x: 0, y: 0 })
  for (const cell of cells) paint.fillStyle(cell.color, 1).fillRect(cell.x, cell.y, 1, 1)
  paint.generateTexture(key, 8, 8)
  paint.clear()
  for (const cell of sleepingDrawingCells(drawing)) paint.fillStyle(cell.color, 1).fillRect(cell.x, cell.y, 1, 1)
  paint.generateTexture(`${key}-asleep`, 8, 8)
  paint.destroy()
}
