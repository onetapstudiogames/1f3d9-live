import type Phaser from 'phaser'
import type { ResidentView } from './ResidentView.ts'
import type { PlaceAnimation } from '../place-animation.ts'

export function fixtureMode(search = window.location.search): boolean {
  const params = new URLSearchParams(search)
  return params.has('replay') || params.has('census')
}

export function browserStorage(): Storage | null { try { return window.localStorage } catch { return null } }

export function visibleFigureList(figures: ReadonlyMap<number, ResidentView>, camera: Phaser.Cameras.Scene2D.Camera,
  width: number, height: number): string {
  return JSON.stringify([...figures].flatMap(([id, figure]) => {
    const x = (figure.sprite.x - camera.worldView.x) * camera.zoom
    const y = (figure.sprite.y - camera.worldView.y) * camera.zoom
    return figure.sprite.visible && x > 30 && x < width - 30 && y > 190 && y < height - 140 ? [{ id, x, y }] : []
  }))
}

export function markFinishedPlaces(running: readonly PlaceAnimation[], active: readonly PlaceAnimation[]): void {
  const still = new Set(active.map(animation => animation.changeId))
  for (const animation of running) if (!still.has(animation.changeId)) {
    document.body.dataset[animation.kind === 'founding' ? 'liveFoundingShown' : 'liveRenameShown'] = 'true'
  }
}

export function recordSpeechFixture(speech: { residentId: number; text: string; shape: string; showing: string } | null,
  fixtureMode: boolean, handshakeCount: number): void {
  document.body.dataset['liveBubbleText'] = speech?.text ?? ''
  document.body.dataset['liveBubbleShape'] = speech?.shape ?? ''
  document.body.dataset['liveBubbleResident'] = speech ? String(speech.residentId) : ''
  if (fixtureMode) document.body.dataset['liveShowing'] = speech?.showing ?? ''
  if (fixtureMode) document.body.dataset['liveShowingResident'] = speech?.showing ? String(speech.residentId) : ''
  if (fixtureMode) document.body.dataset['liveHandshakes'] = String(handshakeCount)
}
