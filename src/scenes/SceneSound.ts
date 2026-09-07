import type Phaser from 'phaser'
import type { NestedLayout } from '../ground/nested.ts'
import { roomsToDraw } from '../room-art.ts'
import type { Simulation } from '../replay/simulation.ts'
import type { PlaceAnimation } from '../place-animation.ts'
import { createSoundState, soundFrame, type SoundState } from '../sound.ts'
import { readSoundEnabled, saveSoundEnabled } from '../preferences.ts'
import type { ResidentView } from './ResidentView.ts'
import { browserStorage } from './fixture-state.ts'
import { SoundView } from './SoundView.ts'
import { boatFrame } from '../sea.ts'

export class SceneSound {
  private state: SoundState = createSoundState()
  private enabled = false
  private trusted = false
  private foreground = true
  private consumeForeground = false
  private readonly view: SoundView
  private readonly trustPointer = (event: Event): void => this.trust(event)
  private readonly trustKey = (event: Event): void => this.trust(event)
  private control: HTMLInputElement | null = null
  private readonly change = (): void => {
    this.enabled = this.control?.checked === true
    saveSoundEnabled(browserStorage(), this.enabled)
    document.body.dataset['liveSound'] = String(this.enabled)
    if (!this.enabled) { this.view.stop(); this.setStatus('') }
  }
  private readonly blur = (): void => { this.foreground = false; this.view.stop() }
  private readonly visibility = (): void => {
    if (document.hidden) this.blur()
    else { this.foreground = true; this.consumeForeground = true }
  }
  constructor(scene: Phaser.Scene) { this.view = new SoundView(scene) }
  connect(): void {
    this.enabled = readSoundEnabled(browserStorage())
    this.control = document.querySelector<HTMLInputElement>('#sound')
    if (this.control) this.control.checked = this.enabled
    document.body.dataset['liveSound'] = String(this.enabled)
    document.addEventListener('pointerdown', this.trustPointer)
    document.addEventListener('click', this.trustPointer)
    document.addEventListener('keydown', this.trustKey)
    document.addEventListener('visibilitychange', this.visibility)
    window.addEventListener('blur', this.blur)
    window.addEventListener('focus', this.visibility)
    this.control?.addEventListener('change', this.change)
  }
  trust(event: Event | undefined): void {
    if (event?.isTrusted !== true) return
    this.trusted = true; void this.view.unlock()
  }
  reset(): void { this.state = createSoundState(); this.view.stop() }
  stop(): void { this.view.stop() }
  destroy(): void {
    document.removeEventListener('pointerdown', this.trustPointer)
    document.removeEventListener('click', this.trustPointer)
    document.removeEventListener('keydown', this.trustKey)
    document.removeEventListener('visibilitychange', this.visibility)
    window.removeEventListener('blur', this.blur)
    window.removeEventListener('focus', this.visibility)
    this.control?.removeEventListener('change', this.change)
    this.view.stop()
  }
  update(now: number, paused: boolean, residents: Simulation, figures: ReadonlyMap<number, ResidentView>,
    animations: readonly PlaceAnimation[], layout: NestedLayout, camera: Phaser.Cameras.Scene2D.Camera): void {
    const width = camera.width / camera.zoom; const height = camera.height / camera.zoom
    const left = camera.scrollX + camera.width / 2 - width / 2; const top = camera.scrollY + camera.height / 2 - height / 2
    const inView = (x: number, y: number): boolean => x >= left && x <= left + width && y >= top && y <= top + height
    const boating: number[] = []
    const soundResidents = Object.values(residents.residents).map(resident => {
      const figureDrawn = figures.get(resident.id)?.sprite.visible === true
      const sailing = resident.walking && resident.walkEventId
        ? boatFrame(layout, resident.path, resident.pathProgress ?? 0, figureDrawn) : null
      if (sailing) boating.push(resident.id)
      return {
      id: resident.id, walkKey: resident.walking ? resident.walkEventId : null, walkElapsed: resident.walkElapsed,
      bubbleKey: resident.bubble ? String(resident.bubble.noteId ?? `${resident.id}:${resident.bubble.startedAt}`) : null,
      drawn: figureDrawn && !sailing, onCamera: inView(resident.x, resident.y),
    } })
    document.body.dataset['liveBoating'] = boating.join(',')
    const drawable = new Set(roomsToDraw(layout).filter(room => !room.quiet).map(room => room.id))
    const activeFoundings = animations.filter(row => row.kind === 'founding').map(row => {
      const room = layout.rooms[row.placeId]
      return { key: row.changeId, endsAt: row.startedAt + row.duration, drawn: drawable.has(row.placeId),
        onCamera: !!room && room.x < left + width && room.x + room.width > left && room.y < top + height && room.y + room.height > top }
    })
    const suppress = !this.foreground || this.consumeForeground
    const frame = soundFrame(this.state, { enabled: this.enabled && !suppress, trusted: this.trusted, paused, now,
      residents: soundResidents, activeFoundings })
    this.state = frame.state
    this.consumeForeground = false
    if (paused) this.view.stop()
    else if (frame.cues.length) this.setStatus(this.view.play(frame.cues) ? '' : 'Sound unavailable')
  }
  private setStatus(message: string): void {
    const status = document.getElementById('sound-state')
    if (status) status.textContent = message
  }
}
