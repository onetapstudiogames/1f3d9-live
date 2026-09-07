import Phaser from 'phaser'
import { fetchReplay, fetchCensus, createDrawingLoader, createThingLoader } from '../city/api.ts'
import type { ReplayFile, Resident } from '../city/types.ts'
import { nestedLayout, type NestedLayout } from '../ground/nested.ts'
import { createClock, advanceClock, chosenSpeed, dueEvents, prepareTimeline, type Clock, type TimelineRow } from '../replay/index.ts'
import { createResidents, stepResidents, roomCapacity, type Simulation } from '../replay/simulation.ts'
import { residentNamePlate } from '../city/residents.ts'
import { RoomView } from './RoomView.ts'
import { ResidentView, addDrawingTexture } from './ResidentView.ts'
import { nearbyRooms } from '../camera.ts'
import { sleepingResidents } from '../sleep.ts'
import { placesWithDrawings } from '../room-art.ts'
import { createThings, stepThings, type ThingSimulation } from '../things.ts'
import { ThingView, addThingTexture } from './ThingView.ts'

export class CityScene extends Phaser.Scene {
  private replay?: ReplayFile
  private timeline: readonly TimelineRow[] = []
  private layout?: NestedLayout
  private residents?: Simulation
  private things?: ThingSimulation
  private thingViews = new Map<number, ThingView>()
  private thingNames = new Map<number, string>()
  private thingReads = new Set<number>()
  private readingThings = false
  private readonly readThing = createThingLoader()
  private readonly readThingDrawing = createDrawingLoader(undefined, 'thing')
  private clock?: Clock
  private rooms?: RoomView
  private figures = new Map<number, ResidentView>()
  private sleepers: ReadonlySet<number> = new Set()
  private cursor = 0
  private elapsed = 0
  private paused = false
  private following: number | null = null
  private viewName = 'The city, room inside room'
  private nearbyIndex = 0
  private readStatus = ''
  private readIssues: string[] = []
  private lastHud = ''
  private lastFigures = ''
  // The test-only figure list is written for the saved-fixture run the browser check drives.
  private readonly fixtureMode = new URLSearchParams(window.location.search).has('replay')
    || new URLSearchParams(window.location.search).has('census')

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
      if (censusRead.status === 'rejected') {
        console.error(censusRead.reason)
        this.readIssues.push('The resident list could not be read, so figures are shown without names.')
      }
      this.replay = record.value
      this.timeline = prepareTimeline(this.replay.timeline)
      this.layout = nestedLayout(this.replay.map.places, roomCapacity(this.replay, census))
      const speed = chosenSpeed(document.querySelector<HTMLSelectElement>('#speed')?.value)
      this.clock = createClock(this.replay.window_start, this.replay.window_end, speed)
      this.sleepers = sleepingResidents(this.replay, census)
      this.things = createThings(this.replay, this.layout)
      this.residents = createResidents(this.replay, census, this.layout, this.things.reservations)
      this.rooms = new RoomView(this, this.layout)
      this.rooms.update(this.cameras.main, this.clock.time)
      addDrawingTexture(this, 'resident-default', null)
      addThingTexture(this, 'thing-default', null)
      this.drawThings()
      this.drawResidents()
      this.focusResidents()
      this.readStatus = `Read ${this.replay.map.places.length} places and ${this.replay.timeline.length} recorded events. ${this.replay.complete ? 'Recorded window loaded.' : 'This is the saved part of the window; older events are not included.'}`
      if (this.sleepers.size) this.readStatus += " Sleep marks use today's census for residents with no recorded activity."
      this.updateHud()
      await this.loadDrawings(census)
      document.body.dataset['liveReady'] = censusRead.status === 'fulfilled' ? 'true' : 'error'
      this.updateHud()
      void this.loadPlaceDrawings()
      void this.loadThingDetails()
    } catch (error) {
      // The reader's own words help nobody reading the page; the console keeps them.
      console.error(error)
      this.readIssues.push('The public record could not be read.')
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
          console.error(error)
          const message = 'Some drawings could not be read; their last figures are kept.'
          if (!this.readIssues.includes(message)) this.readIssues.push(message)
        }
      }))
    }
  }

  private async loadPlaceDrawings(): Promise<void> {
    if (!this.layout || !this.replay) return
    const drawing = createDrawingLoader(undefined, 'place')
    const ids = placesWithDrawings(this.replay.map.places, this.layout)
    for (let offset = 0; offset < ids.length; offset += 4) {
      await Promise.all(ids.slice(offset, offset + 4).map(async id => {
        try {
          const art = await drawing(id)
          if (art) this.rooms?.addDrawing(this, id, art)
        } catch (error) {
          console.error(error)
          const message = 'Some place drawings could not be read; their rooms are kept.'
          if (!this.readIssues.includes(message)) this.readIssues.push(message)
        }
      }))
    }
    if (this.fixtureMode) document.body.dataset['livePlaceDrawing'] = String(this.textures.exists('place-1'))
  }

  update(_time: number, delta: number): void {
    if (!this.clock || !this.residents || !this.layout || !this.replay) return
    if (document.body.dataset['liveReady'] === 'true' && !this.paused) {
      const elapsed = Math.min(100, Math.max(0, delta))
      this.elapsed += elapsed
      // Hold the recorded moment for its walks, words and arrivals, then resume the faster clock.
      if (!this.residents.pending && !this.things?.pending) this.clock = advanceClock(this.clock, elapsed)
      const due = dueEvents(this.timeline, this.cursor, this.clock.time)
      this.cursor = due.cursor
      if (this.things) this.things = stepThings(this.things, due.events, this.elapsed, this.clock.speed)
      this.residents = stepResidents(this.residents, due.events, elapsed, this.elapsed, this.layout, this.clock.speed)
    }
    this.drawThings()
    this.drawResidents()
    this.rooms?.update(this.cameras.main, this.clock.time)
    this.updateHud()
  }

  private drawThings(): void {
    const state = this.things?.things ?? {}
    for (const [id, view] of this.thingViews) {
      if (!state[id]) { view.destroy(); this.thingViews.delete(id) }
    }
    for (const thing of Object.values(state)) {
      let view = this.thingViews.get(thing.id)
      if (!view) {
        view = new ThingView(this)
        if (this.textures.exists(`thing-${thing.id}`)) view.sprite.setTexture(`thing-${thing.id}`)
        this.thingViews.set(thing.id, view)
      }
      view.update(thing, thing.name ?? this.thingNames.get(thing.id) ?? null, this.cameras.main.zoom, this.elapsed)
    }
    if (document.body.dataset['liveReady'] === 'true') void this.loadThingDetails()
    if (this.fixtureMode) {
      document.body.dataset['liveThings'] = JSON.stringify(Object.values(state).filter(thing => thing.visible).map(thing => ({
        id: thing.id, name: thing.name ?? this.thingNames.get(thing.id) ?? null,
      })))
    }
  }

  private async loadThingDetails(): Promise<void> {
    if (this.readingThings) return
    this.readingThings = true
    try {
      for (;;) {
        const batch = Object.values(this.things?.things ?? {}).filter(thing => thing.visible && !this.thingReads.has(thing.id)).slice(0, 4)
        if (!batch.length) break
        for (const thing of batch) this.thingReads.add(thing.id)
        await Promise.all(batch.map(async thing => {
          // One read per thing carries both the name and whether the city has art for it.
          // A thing that says it has no drawing is never asked for one, as for residents and places.
          let hasDrawing = true
          try {
            const detail = await this.readThing(thing.id)
            if (detail) {
              this.thingNames.set(thing.id, detail.name)
              hasDrawing = detail.has_drawing
            } else if (thing.name === null) {
              this.thingReadIssue('Some thing names are missing; those name plates stay blank.')
            }
          } catch (error) {
            console.error(error)
            if (thing.name === null) this.thingReadIssue('Some thing names could not be read; those name plates stay blank.')
          }
          if (!hasDrawing) return
          try {
            const art = await this.readThingDrawing(thing.id)
            if (art) {
              addThingTexture(this, `thing-${thing.id}`, art)
              this.thingViews.get(thing.id)?.sprite.setTexture(`thing-${thing.id}`)
            }
          } catch (error) {
            console.error(error)
            this.thingReadIssue('Some thing drawings could not be read; their pixel icons are kept.')
          }
        }))
      }
    } finally { this.readingThings = false }
  }

  private thingReadIssue(message: string): void {
    if (!this.readIssues.includes(message)) this.readIssues.push(message)
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
      figure.update(resident, camera.zoom, this.elapsed, resident.id === this.following, this.sleepers.has(resident.id), this.clock?.time ?? Number.NaN)
    }
    if (!this.fixtureMode) return
    const listed = JSON.stringify([...this.figures].flatMap(([id, figure]) => {
      const x = (figure.sprite.x - camera.worldView.x) * camera.zoom
      const y = (figure.sprite.y - camera.worldView.y) * camera.zoom
      return figure.sprite.visible && x > 30 && x < this.scale.width - 30 && y > 190 && y < this.scale.height - 140
        ? [{ id, x, y }] : []
    }))
    if (listed === this.lastFigures) return
    this.lastFigures = listed
    document.body.dataset['liveFigures'] = listed
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
      if (this.clock) this.clock = { ...this.clock, speed: chosenSpeed((event.target as HTMLSelectElement).value) }
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
    const followed = resident ? residentNamePlate(resident.handle) : null
    const view = document.getElementById('view')
    if (view) {
      view.textContent = resident
        ? `Following ${followed ?? 'a figure the resident list does not name'} · click floor to stop`
        : this.viewName
    }
    const pending = this.residents?.pending || this.things?.pending
    const ended = this.clock && this.clock.time >= this.clock.end && !pending
    const failed = document.body.dataset['liveReady'] === 'error'
    const state = failed ? 'Playback is stopped; the last drawn state is kept.' : !this.clock ? ''
      : document.body.dataset['liveReady'] === 'loading' ? 'Reading resident drawings.'
      : ended ? 'Replay finished. The live feed is not connected yet.'
      : this.paused ? 'Paused.' : pending ? 'Watching a recorded moment.' : 'The clock runs faster between recorded moments.'
    const issues = [...this.readIssues, ...(this.residents?.issues ?? []), ...(this.things?.issues ?? [])]
    const status = `${this.readStatus} ${state}${issues.length ? ` ${issues.join(' ')}` : ''}`.trim()
    if (status !== this.lastHud) {
      document.getElementById('status')!.textContent = status
      this.lastHud = status
    }
  }
}
