import Phaser from 'phaser'
import { fetchReplay } from '../city/api.ts'
import type { ReplayFile } from '../city/types.ts'
import { stageChildPlaces, stageRoomLayout } from '../ground/stage-ground.ts'

// Version zero: read the replay file, lay the continents out as rooms with the salvaged
// ground math, draw each as a floor with its name, and put one plain figure per resident
// standing at the window's start. Everything after this is the plan in docs/PLAN.md.
export class CityScene extends Phaser.Scene {
  constructor() { super('city') }

  create(): void {
    const status = document.getElementById('status')
    fetchReplay().then(replay => {
      this.drawReplay(replay)
      if (status) status.textContent = `${replay.map.places.length} places · ${Object.keys(replay.start).length} residents standing · ${replay.timeline.length} recorded events (${replay.span})`
      document.body.dataset['liveReady'] = 'true'
    }).catch(error => {
      if (status) status.textContent = `could not read the public record: ${String(error)}`
      document.body.dataset['liveReady'] = 'error'
    })
  }

  private drawReplay(replay: ReplayFile): void {
    const world = replay.map.places.find(place => place.parent_id === null)
    if (!world) return
    const continents = stageChildPlaces(replay.map.places, world.id)
    const layout = stageRoomLayout(continents, world.id)
    const floors = this.add.graphics()
    const residentsByPlace = new Map<number, number>()
    for (const start of Object.values(replay.start)) {
      residentsByPlace.set(start.place_id, (residentsByPlace.get(start.place_id) ?? 0) + 1)
    }
    for (const room of Object.values(layout.rooms)) {
      floors.fillStyle(0x1c4434, 1)
      floors.fillRect(room.x, room.y, room.width, room.height)
      floors.lineStyle(2, 0xf0e6c8, 0.6)
      floors.strokeRect(room.x, room.y, room.width, room.height)
      const place = continents.find(candidate => String(candidate.id) === String(room.id))
      this.add.text(room.x + 8, room.y + 6, place?.name ?? String(room.id), { fontFamily: 'monospace', fontSize: '14px', color: '#f0e6c8' })
      const count = residentsByPlace.get(Number(room.id)) ?? 0
      for (let index = 0; index < Math.min(count, 12); index += 1) {
        const figure = this.add.rectangle(room.x + 24 + (index % 6) * 40, room.y + 48 + Math.floor(index / 6) * 40, 16, 24, 0xf0c95f)
        figure.setOrigin(0.5, 1)
      }
    }
    this.cameras.main.setBounds(0, 0, Math.max(layout.width, this.scale.width), Math.max(layout.height, this.scale.height))
    this.cameras.main.setZoom(Math.min(1, this.scale.width / Math.max(layout.width, 1)))
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      const next = Phaser.Math.Clamp(this.cameras.main.zoom * (dy > 0 ? 0.9 : 1.1), 0.2, 4)
      this.cameras.main.setZoom(next)
    })
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) return
      this.cameras.main.scrollX -= (pointer.x - pointer.prevPosition.x) / this.cameras.main.zoom
      this.cameras.main.scrollY -= (pointer.y - pointer.prevPosition.y) / this.cameras.main.zoom
    })
  }
}
