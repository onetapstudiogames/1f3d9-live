import type Phaser from 'phaser'
import type { ResidentView } from './ResidentView.ts'
import type { PlaceAnimation } from '../place-animation.ts'

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
