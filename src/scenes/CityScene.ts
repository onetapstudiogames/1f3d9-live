import Phaser from 'phaser'
import { fetchReplay, fetchCensus, createDrawingLoader } from '../city/api.ts'
import type { ReplayFile, Resident } from '../city/types.ts'
import { nestedLayout, type NestedLayout } from '../ground/nested.ts'
import { createClock, advanceClock, dueEvents, type Clock } from '../replay/index.ts'
import { createResidents, stepResidents, roomCapacity, type Simulation } from '../replay/simulation.ts'
import { RoomView } from './RoomView.ts'
import { ResidentView, addDrawingTexture } from './ResidentView.ts'
import { nearbyRooms } from '../camera.ts'

export class CityScene extends Phaser.Scene {
  private replay?: ReplayFile
  private layout?: NestedLayout
  private residents?: Simulation
  private clock?: Clock
  private rooms?: RoomView
  private figures = new Map<number, ResidentView>()
  private cursor = 0
  private elapsed = 0
  private paused = false
  private following: number | null = null
  private viewName = 'The city, room inside room'
  private nearbyIndex = 0
  private readStatus = ''
  private readIssues: string[] = []
  private lastHud = ''

  constructor() { super('city') }

  create(): void {
    document.body.dataset['liveReady'] = 'loading'
    document.body.dataset['liveFollowing'] = ''
    this.connectControls()
    void this.loadCity()
  }

  private async loadCity(): Promise<void> {
    try {
      const [record, censusRead] = await Promise.allSettled([fetchReplay(), fetchCensus()])
      if (record.status === 'rejected') throw record.reason
      const census = censusRead.status === 'fulfilled' ? censusRead.value : []
      if (censusRead.status === 'rejected') this.readIssues.push(`Could not read the resident list: ${String(censusRead.reason)}`)
      this.replay = record.value
      this.layout = nestedLayout(this.replay.map.places, roomCapacity(this.replay, census))
      this.clock = createClock(this.replay.window_start, this.replay.window_end)
      this.residents = createResidents(this.replay, census, this.layout)
      this.rooms = new RoomView(this, this.layout)
      addDrawingTexture(this, 'resident-default', null)
      this.drawResidents()
      this.focusResidents()
      this.readStatus = `Read ${this.replay.map.places.length} places and ${this.replay.timeline.length} recorded events. ${this.replay.complete ? 'Recorded window loaded.' : 'This is the saved part of the window; older events are not included.'}`
      this.updateHud()
      await this.loadDrawings(census)
      document.body.dataset['liveReady'] = censusRead.status === 'fulfilled' ? 'true' : 'error'
      this.updateHud()
    } catch (error) {
      this.readIssues.push(`Could not read the public record: ${String(error)}`)
      document.body.dataset['liveReady'] = 'error'
      this.updateHud()
    }
  }

  private async loadDrawings(census: readonly Resident[]): Promise<void> {
    const drawing = createDrawingLoader()
    const ids = [...new Set([
      ...census.filter(resident => resident.has_drawing).map(resident => resident.id),
      ...Object.values(this.residents?.residents ?? {}).filter(resident => !census.some(row => row.id === resident.id)).map(resident => resident.id),
    ])]
    for (let offset = 0; offset < ids.length; offset += 4) {
      await Promise.all(ids.slice(offset, offset + 4).map(async id => {
        try {
          const art = await drawing(id)
          addDrawingTexture(this, `resident-${id}`, art)
          this.figures.get(id)?.sprite.setTexture(`resident-${id}`)
        } catch (error) {
          const message = `Some drawings could not be read; their last figures are kept. ${String(error)}`
          if (!this.readIssues.some(issue => issue.startsWith('Some drawings'))) this.readIssues.push(message)
        }
      }))
    }
  }

  update(_time: number, delta: number): void {
    if (!this.clock || !this.residents || !this.layout || !this.replay) return
    if (document.body.dataset['liveReady'] === 'true' && !this.paused) {
      const elapsed = Math.min(100, Math.max(0, delta))
      this.elapsed += elapsed
      // Hold the recorded moment for its walks and words, then resume the faster clock.
      if (!this.residents.pending) this.clock = advanceClock(this.clock, elapsed)
      const due = dueEvents(this.replay.timeline, this.cursor, this.clock.time)
      this.cursor = due.cursor
      this.residents = stepResidents(this.residents, due.events, elapsed, this.elapsed, this.layout)
    }
    this.drawResidents()
    this.rooms?.update(this.cameras.main)
    this.updateHud()
  }

  private drawResidents(): void {
    const camera = this.cameras.main
    for (const resident of Object.values(this.residents?.residents ?? {})) {
      let figure = this.figures.get(resident.id)
      if (!figure) {
        figure = new ResidentView(this, resident)
        if (this.textures.exists(`resident-${resident.id}`)) figure.sprite.setTexture(`resident-${resident.id}`)
        this.figures.set(resident.id, figure)
      }
      figure.update(resident, camera.zoom, this.elapsed, resident.id === this.following)
    }
    document.body.dataset['liveFigures'] = JSON.stringify([...this.figures].flatMap(([id, figure]) => {
      const x = (figure.sprite.x - camera.worldView.x) * camera.zoom
      const y = (figure.sprite.y - camera.worldView.y) * camera.zoom
      return figure.sprite.visible && x > 30 && x < this.scale.width - 30 && y > 190 && y < this.scale.height - 140
        ? [{ id, x, y }] : []
    }))
  }

  private connectControls(): void {
    const camera = this.cameras.main
    let dragged = false
    this.input.on('pointerdown', () => { dragged = false })
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown || pointer.getDistance() < 5) return
      dragged = true
      this.stopFollowing()
      camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom
      camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom
    })
    this.input.on('pointerup', (_pointer: Phaser.Input.Pointer, objects: Phaser.GameObjects.GameObject[]) => {
      if (dragged) return
      const id = objects.find(object => typeof object.getData('residentId') === 'number')?.getData('residentId') as number | undefined
      if (id === undefined) this.stopFollowing()
      else this.follow(id)
    })
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => this.zoom(dy > 0 ? 0.85 : 1.18))
    document.getElementById('pause')?.addEventListener('click', () => {
      this.paused = !this.paused
      document.getElementById('pause')!.textContent = this.paused ? 'Play' : 'Pause'
    })
    document.getElementById('speed')?.addEventListener('change', event => {
      if (this.clock) this.clock = { ...this.clock, speed: Number((event.target as HTMLSelectElement).value) }
    })
    document.getElementById('in')?.addEventListener('click', () => this.zoom(1.3))
    document.getElementById('out')?.addEventListener('click', () => this.zoom(1 / 1.3))
    document.getElementById('city')?.addEventListener('click', () => this.showWholeCity())
    document.getElementById('nearby')?.addEventListener('click', () => this.focusResidents())
  }

  private zoom(factor: number): void {
    const camera = this.cameras.main
    const x = camera.midPoint.x
    const y = camera.midPoint.y
    camera.setZoom(Phaser.Math.Clamp(camera.zoom * factor, 0.005, 3)).centerOn(x, y)
  }

  private follow(id: number): void {
    const figure = this.figures.get(id)
    if (!figure) return
    this.following = id
    this.cameras.main.startFollow(figure.sprite, false, 0.12, 0.12)
    document.body.dataset['liveFollowing'] = String(id)
  }

  private stopFollowing(): void {
    this.cameras.main.stopFollow()
    this.following = null
    document.body.dataset['liveFollowing'] = ''
  }

  private focusResidents(): void {
    this.stopFollowing()
    if (!this.layout || !this.residents) return
    const choices = nearbyRooms(this.layout, Object.values(this.residents.residents))
    const room = choices[this.nearbyIndex++ % choices.length]
    if (!room) { this.showWholeCity(); return }
    const zoom = Math.min(0.95, (this.scale.width - 70) / (room.width + 60), (this.scale.height - 230) / (room.height + 60))
    this.cameras.main.setZoom(zoom).centerOn(room.x + room.width / 2, room.y + room.height / 2)
    this.viewName = room.name
  }

  private showWholeCity(): void {
    if (!this.layout) return
    this.stopFollowing()
    this.viewName = 'The whole city · zoom in to read the rooms'
    this.cameras.main.setZoom(Math.min((this.scale.width - 40) / this.layout.width, (this.scale.height - 210) / this.layout.height))
      .centerOn(this.layout.width / 2, this.layout.height / 2)
  }

  private updateHud(): void {
    const time = document.getElementById('clock')
    if (time && this.clock) {
      time.textContent = new Date(this.clock.time).toISOString().replace('T', ' · ').slice(0, 21)
      time.setAttribute('datetime', new Date(this.clock.time).toISOString())
    }
    const resident = this.following === null ? undefined : this.residents?.residents[this.following]
    const view = document.getElementById('view')
    if (view) view.textContent = resident ? `Following ${resident.handle} · click floor to stop` : this.viewName
    const ended = this.clock && this.clock.time >= this.clock.end && !this.residents?.pending
    const failed = document.body.dataset['liveReady'] === 'error'
    const state = failed ? 'Playback is stopped; the last drawn state is kept.' : !this.clock ? ''
      : document.body.dataset['liveReady'] === 'loading' ? 'Reading resident drawings.'
      : ended ? 'Replay finished. The live feed is not connected yet.'
      : this.paused ? 'Paused.' : this.residents?.pending ? 'Watching a recorded moment.' : 'The clock runs faster between recorded moments.'
    const issues = [...this.readIssues, ...(this.residents?.issues ?? [])]
    const status = `${this.readStatus} ${state}${issues.length ? ` ${issues.join(' ')}` : ''}`.trim()
    if (status !== this.lastHud) {
      document.getElementById('status')!.textContent = status
      this.lastHud = status
    }
  }
}
