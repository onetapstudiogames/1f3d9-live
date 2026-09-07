import Phaser from 'phaser'
import type { ReplayEvent } from '../city/types.ts'
import type { NestedLayout } from '../ground/nested.ts'
import { directorActivity, directorStep, rankDirectorRooms, type DirectorState } from '../director.ts'
import { roomsToDraw } from '../room-art.ts'

export class DirectorView {
  private state: DirectorState = Object.freeze({ roomId: null, nextAt: 0 })
  private glide?: Phaser.Tweens.Tween
  enabled = false
  status = ''
  constructor(private readonly scene: Phaser.Scene, private readonly showRoom: (id: number) => void) {}
  connect(beforeEnable: () => void): void {
    document.getElementById('director')?.addEventListener('change', event => {
      const enabled = (event.target as HTMLInputElement).checked
      if (!enabled) { this.stop(); return }
      beforeEnable(); this.enabled = true; this.syncControl()
    })
    this.syncControl()
  }
  update(events: readonly ReplayEvent[], recordedNow: number, realNow: number, layout: NestedLayout,
    hidden: ReadonlySet<number>): void {
    if (!this.enabled) return
    if (realNow < this.state.nextAt && (this.state.roomId === null || !hidden.has(this.state.roomId)))
      return
    const known = new Set(roomsToDraw(layout).filter(room => !room.quiet).map(room => room.id))
    const ranked = rankDirectorRooms(directorActivity(events, recordedNow), known, hidden)
    const stepped = directorStep(this.state, ranked, realNow)
    if (stepped.waiting || (this.state.roomId !== null && hidden.has(this.state.roomId))) {
      this.glide?.stop(); this.glide = undefined
    }
    this.state = Object.freeze({ roomId: stepped.roomId, nextAt: stepped.waiting ? realNow + 1_000 : stepped.nextAt })
    if (stepped.changed && stepped.roomId !== null) this.glideTo(layout.rooms[stepped.roomId]!)
    this.status = stepped.waiting ? 'Director is waiting for recent recorded activity.' : ''
    if (stepped.changed && stepped.roomId !== null) this.showRoom(stepped.roomId)
  }
  stop(): void {
    this.glide?.stop(); this.glide = undefined
    this.state = Object.freeze({ roomId: null, nextAt: 0 })
    this.enabled = false; this.status = ''; this.syncControl()
  }
  private syncControl(): void {
    const control = document.querySelector<HTMLInputElement>('#director')
    if (control) control.checked = this.enabled
    document.body.dataset['liveDirector'] = String(this.enabled)
  }
  private glideTo(room: NestedLayout['rooms'][number]): void {
    const camera = this.scene.cameras.main
    this.glide?.stop()
    const point = { x: camera.midPoint.x, y: camera.midPoint.y, zoom: camera.zoom }
    const zoom = Math.max(0.05, Math.min(0.95, (this.scene.scale.width - 70) / (room.width + 60), (this.scene.scale.height - 230) / (room.height + 60)))
    this.glide = this.scene.tweens.add({ targets: point, x: room.x + room.width / 2, y: room.y + room.height / 2, zoom,
      duration: 900, ease: 'Sine.InOut', onUpdate: () => camera.setZoom(point.zoom).centerOn(point.x, point.y),
      onComplete: () => { this.glide = undefined } })
  }
}
