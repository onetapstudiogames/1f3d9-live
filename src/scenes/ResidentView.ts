import Phaser from 'phaser'
import type { Drawing, ReplayPlace } from '../city/types.ts'
import { drawingCells } from '../city/drawing.ts'
import { sleepingDrawingCells } from '../sleep.ts'
import { residentNamePlate } from '../city/residents.ts'
import type { ResidentState } from '../replay/simulation.ts'
import { sparkleAlpha } from '../newcomers.ts'
import { bubbleShape } from '../speech.ts'
import { BubbleView } from './BubbleView.ts'
import { residentBobOffset } from '../resident-bob.ts'
import { ballotCells, confettiCells, showingFor, showingFrame, spotlightCells } from '../showing.ts'
import { reappearanceAlpha } from '../viewer.ts'
import { ROOM_RESIDENT_SIZE, roomFigureStyle, roomNameStyle, roomTextResolution } from '../room-appearance.ts'
import { RESIDENT_LOCK_RECTS, RESIDENT_SLEEP_RECTS, residentOverlayDistance, residentOverlayRects } from '../resident-overlays.ts'

export type VisibleSpeech = Readonly<{ residentId: number; text: string; shape: string; showing: string }>
export type ResidentLabelBounds = Readonly<{ x: number; y: number; width: number; height: number }>

const SPOTLIGHT_CELLS = residentOverlayRects(spotlightCells())
const BALLOT_CELLS = residentOverlayRects(ballotCells())
const CONFETTI_CELLS = residentOverlayRects(confettiCells())

export class ResidentView {
  readonly sprite: Phaser.GameObjects.Image
  private readonly name: Phaser.GameObjects.Text
  private readonly bubble: BubbleView
  private readonly zzz: Phaser.GameObjects.Graphics
  private readonly sparkle: Phaser.GameObjects.Graphics
  private showing: Phaser.GameObjects.Graphics | null = null
  private contest: Phaser.GameObjects.Graphics | null = null
  private lock: Phaser.GameObjects.Graphics | null = null
  private readonly named: boolean
  private nameAllowed = false
  private standingTexture = 'resident-default'

  constructor(scene: Phaser.Scene, resident: ResidentState) {
    const plate = residentNamePlate(resident.handle)
    const nameStyle = roomNameStyle(window.devicePixelRatio)
    this.named = plate !== null
    this.sprite = scene.add.image(resident.x, resident.y, 'resident-default')
      .setScale(roomFigureStyle('resident').scale).setDepth(100).setInteractive({ useHandCursor: true }).setData('residentId', resident.id)
    this.name = scene.add.text(0, 0, plate ?? '', {
      fontFamily: 'system-ui, sans-serif', fontSize: `${nameStyle.fontSize}px`, color: '#534b3b', resolution: nameStyle.resolution,
      backgroundColor: '#eee3cc', padding: { x: nameStyle.paddingX, y: nameStyle.paddingY },
    }).setOrigin(0.5, 0).setDepth(101)
    this.name.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
    this.sparkle = scene.add.graphics().setDepth(102).setVisible(false)
    this.sparkle.fillStyle(0xffe69a, 1)
    for (const [sourceX, sourceY] of [[-25, -10], [21, -19], [18, 13]] as const) {
      const x = residentOverlayDistance(sourceX); const y = residentOverlayDistance(sourceY)
      const short = residentOverlayDistance(3); const long = residentOverlayDistance(9)
      this.sparkle.fillRect(x, y - short, short, long).fillRect(x - short, y, long, short)
    }
    this.bubble = new BubbleView(resident.id)
    this.zzz = scene.add.graphics().setDepth(102).setVisible(false)
    for (const cell of RESIDENT_SLEEP_RECTS) this.zzz.fillStyle(cell.color, cell.alpha)
      .fillRect(cell.x, cell.y, cell.width, cell.height)
  }

  update(resident: ResidentState, now: number, asleep = false, places: readonly ReplayPlace[] = [],
    viewport: Readonly<{ width: number; height: number }> = { width: 0, height: 0 }): VisibleSpeech | null {
    const resolution = roomTextResolution(window.devicePixelRatio)
    if (this.name.style.resolution !== resolution) this.name.setResolution(resolution)
    const currentTexture = this.sprite.texture.key
    if (!currentTexture.endsWith('-asleep')) this.standingTexture = currentTexture
    const sleeping = asleep && !resident.walking && resident.bubble === null
    const texture = sleeping && this.sprite.scene.textures.exists(`${this.standingTexture}-asleep`)
      ? `${this.standingTexture}-asleep` : this.standingTexture
    if (this.sprite.texture.key !== texture) this.sprite.setTexture(texture)
    const bob = residentBobOffset(resident.id, now, resident.walking || resident.ambientWalking === true, sleeping)
    this.sprite.setPosition(resident.x, resident.y + bob).setFlipX(resident.flipX).setVisible(resident.visible)
    const appearance = reappearanceAlpha(resident.relocatedAt, now)
    for (const item of [this.sprite, this.name, this.zzz]) item.setAlpha(appearance)
    this.nameAllowed = this.named && resident.visible
    this.name.setPosition(resident.x, resident.y + ROOM_RESIDENT_SIZE / 2 + 5).setVisible(this.nameAllowed)
    const alpha = sparkleAlpha(resident.sparkle, now)
    this.sparkle.setPosition(resident.x, resident.y).setAlpha(alpha).setVisible(resident.visible && alpha > 0)
    this.zzz.setPosition(resident.x + ROOM_RESIDENT_SIZE / 2 - residentOverlayDistance(3),
      resident.y - ROOM_RESIDENT_SIZE / 2).setVisible(sleeping && resident.visible)
    const blocked = resident.visible ? resident.blockedAttempt : null
    if (blocked) {
      this.lock ??= this.sprite.scene.add.graphics().setDepth(204)
      this.lock.clear().setPosition(resident.x + residentOverlayDistance(-5),
        resident.y - ROOM_RESIDENT_SIZE / 2 + residentOverlayDistance(-20))
      for (const cell of RESIDENT_LOCK_RECTS) this.lock.fillStyle(cell.color, cell.alpha)
        .fillRect(cell.x, cell.y, cell.width, cell.height)
    } else if (this.lock) {
      this.lock.destroy(); this.lock = null
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
      for (const cell of SPOTLIGHT_CELLS) this.showing.fillStyle(cell.color, cell.alpha * contest.alpha)
        .fillRect(cell.x, cell.y, cell.width, cell.height)
      this.contest.setPosition(resident.x, resident.y)
      if (contest.ballotY !== null) for (const [index, cell] of BALLOT_CELLS.entries()) this.contest.fillStyle(cell.color, cell.alpha)
        .fillRect(cell.x, cell.y + (index < 2 ? residentOverlayDistance(contest.ballotY) : 0), cell.width, cell.height)
      if (contest.confetti) for (const cell of CONFETTI_CELLS) this.contest.fillStyle(cell.color, contest.confetti)
        .fillRect(cell.x, cell.y + residentOverlayDistance(Math.round(contest.confetti * 12)), cell.width, cell.height)
    } else if (this.showing || this.contest) {
      this.showing?.destroy(); this.contest?.destroy(); this.showing = null; this.contest = null
    }
    const shape = bubbleShape(bubble?.placeId ?? null, places)
    const frame = this.bubble.update(resident.visible ? bubble : null, resident,
      viewport, shape, now, appearance)
    if (frame) return Object.freeze({ residentId: resident.id, text: frame.text, shape,
      showing: moment?.confetti ? 'confetti' : moment?.ballot ? 'ballot' : moment ? 'spotlight' : '' })

    return null
  }

  labelBounds(): ResidentLabelBounds | null {
    if (!this.name.visible) return null
    const name = this.name.getBounds()
    return Object.freeze({ x: name.x, y: name.y, width: name.width, height: name.height })
  }

  setNameVisible(visible: boolean): void {
    this.name.setVisible(this.nameAllowed && visible)
  }

  destroy(): void {
    this.sprite.destroy()
    this.name.destroy()
    this.bubble.destroy()
    this.zzz.destroy()
    this.sparkle.destroy()
    this.showing?.destroy()
    this.contest?.destroy()
    this.lock?.destroy()
  }
}

export function addDrawingTexture(scene: Phaser.Scene, key: string, drawing: Drawing | null): void {
  if (scene.textures.exists(key)) return
  const cells = drawingCells(drawing)
  const paint = scene.make.graphics({ x: 0, y: 0 })
  for (const cell of cells) paint.fillStyle(cell.color, 1).fillRect(cell.x, cell.y, 1, 1)
  paint.generateTexture(key, 8, 8)
  scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST)
  paint.clear()
  for (const cell of sleepingDrawingCells(drawing)) paint.fillStyle(cell.color, 1).fillRect(cell.x, cell.y, 1, 1)
  paint.generateTexture(`${key}-asleep`, 8, 8)
  scene.textures.get(`${key}-asleep`).setFilter(Phaser.Textures.FilterMode.NEAREST)
  paint.destroy()
}
