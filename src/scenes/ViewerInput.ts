import type Phaser from 'phaser'
import type { Point } from '../ground/nested.ts'
import { saveShowSleepers } from '../preferences.ts'
import { browserStorage } from './fixture-state.ts'

type Actions = Readonly<{
  browse: () => void; follow: (id: number) => void; zoom: (factor: number, anchor?: Point) => void
  trust: (event: Event) => void
}>

export function connectViewerControls(scene: Phaser.Scene, actions: Actions & Readonly<{
  focus: () => void; sleepers: (shown: boolean) => void; stop: () => void; minimap: (shown: boolean) => void
}>): void {
  connectViewerInput(scene, actions)
  const clicks: Readonly<Record<string, () => void>> = {
    nearby: actions.focus, 'follow-stop': actions.stop,
    'minimap-toggle': () => actions.minimap(document.getElementById('minimap')?.hidden === true),
  }
  for (const [id, action] of Object.entries(clicks)) document.getElementById(id)?.addEventListener('click', action)
  document.getElementById('show-sleepers')?.addEventListener('change', event => {
    const shown = (event.target as HTMLInputElement).checked
    saveShowSleepers(browserStorage(), shown); document.body.dataset['liveShowSleepers'] = String(shown); actions.sleepers(shown)
  })
  document.getElementById('follow-picker')?.addEventListener('change', event => {
    const value = (event.target as HTMLSelectElement).value; const id = Number(value)
    if (value && Number.isSafeInteger(id)) actions.follow(id)
  })
}

export function connectViewerInput(scene: Phaser.Scene, actions: Actions): void {
  scene.input.addPointer(1)
  let dragged = false
  let pinched = false
  let distance = 0
  const touches = (): Phaser.Input.Pointer[] => scene.input.manager.pointers.filter(pointer => pointer.isDown)
  const gap = (points: Phaser.Input.Pointer[]): number => Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y)
  scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    actions.trust(pointer.event)
    const points = touches()
    if (points.length < 2) { dragged = false; pinched = false; distance = 0; return }
    pinched = true; dragged = true; distance = gap(points); actions.browse()
  })
  scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
    if (!pointer.isDown) return
    const points = touches()
    if (points.length >= 2) {
      const next = gap(points)
      if (distance > 0 && next > 0) actions.zoom(next / distance,
        { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 })
      distance = next; pinched = true; dragged = true; return
    }
    if (pinched || pointer.getDistance() < 5) return
    dragged = true; actions.browse()
    const camera = scene.cameras.main
    camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom
    camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom
  })
  scene.input.on('pointerup', (_pointer: Phaser.Input.Pointer, objects: Phaser.GameObjects.GameObject[]) => {
    if (dragged || pinched) return
    const id = objects.find(object => typeof object.getData('residentId') === 'number')?.getData('residentId') as number | undefined
    if (id !== undefined) actions.follow(id)
  })
  scene.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) =>
    actions.zoom(dy > 0 ? 0.85 : 1.18, { x: pointer.x, y: pointer.y }))
}

export function connectUiVisibility(): () => void {
  const button = document.querySelector<HTMLButtonElement>('#ui-toggle')
  const toggle = (): void => {
    const hidden = document.body.dataset['uiHidden'] !== 'true'
    document.body.dataset['uiHidden'] = String(hidden)
    button?.setAttribute('aria-label', hidden ? 'Show controls' : 'Hide controls')
    button?.setAttribute('title', hidden ? 'Show controls' : 'Hide controls')
    button?.setAttribute('aria-pressed', String(hidden))
  }
  button?.addEventListener('click', toggle)
  return () => button?.removeEventListener('click', toggle)
}
