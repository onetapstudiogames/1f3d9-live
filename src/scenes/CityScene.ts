import Phaser from 'phaser'
import { fetchReplay, fetchCensus, createDrawingLoader, createThingLoader, createNameHistoryLoader, createPlaceOutlineLoader } from '../city/api.ts'
import type { PlaceOutline, ReplayFile, Resident } from '../city/types.ts'
import { nestedLayout, type NestedLayout } from '../ground/nested.ts'
import { createClock, chosenSpeed, dueEvents, prepareTimeline, type Clock, type TimelineRow } from '../replay/index.ts'
import { createResidents, stepResidents, roomCapacity, type Simulation } from '../replay/simulation.ts'
import { residentNamePlate } from '../city/residents.ts'
import { RoomView } from './RoomView.ts'
import { ResidentView, addDrawingTexture } from './ResidentView.ts'
import { nearbyRooms, roomsInCamera } from '../camera.ts'
import { sleepingResidents } from '../sleep.ts'
import { placesWithDrawings } from '../room-art.ts'
import { addPresentThings, createThings, recordThingIds, stepThings, type ThingSimulation } from '../things.ts'
import type { StageStandingSpot } from '../ground/stage-ground.ts'
import { ThingView, addThingTexture } from './ThingView.ts'
import { createHandovers, stepHandovers, type HandoverState } from '../handovers.ts'
import { HandoverView } from './HandoverView.ts'
import { hiddenRooms, planPlaces, recordedRoomName, type NameSpan, type PlacePlan } from '../places.ts'
import {
  advanceToPlaceMoment, contentHiddenRooms, placeAnimation, stepPlaceAnimations, type PlaceAnimation,
} from '../place-animation.ts'
import { followChoices } from '../follow.ts'
import { readShowSleepers, saveShowSleepers } from '../preferences.ts'

export class CityScene extends Phaser.Scene {
  private replay?: ReplayFile
  private timeline: readonly TimelineRow[] = []
  private layout?: NestedLayout
  private residents?: Simulation
  private things?: ThingSimulation
  private handovers?: HandoverState
  private handoverFrame?: ReturnType<typeof stepHandovers>
  private handoverViews = new Map<string, HandoverView>()
  private thingViews = new Map<number, ThingView>()
  private thingNames = new Map<number, string>()
  private thingReads = new Set<number>()
  private readingThings = false
  private readonly readThing = createThingLoader()
  private readonly readThingDrawing = createDrawingLoader(undefined, 'thing')
  private readonly readOutline = createPlaceOutlineLoader()
  private outlineReads = new Set<number>()
  private outlineActive = 0
  private outlinePending = new Map<number, PlaceOutline>()
  private recordThingIds: ReadonlySet<number> = new Set()
  private clock?: Clock
  private rooms?: RoomView
  private placePlan?: PlacePlan
  private placeMoments: readonly number[] = []
  private placeAnimations: readonly PlaceAnimation[] = []
  private hiddenPlaces: ReadonlySet<number> = new Set()
  private contentsHidden: ReadonlySet<number> = new Set()
  private figures = new Map<number, ResidentView>()
  private sleepers: ReadonlySet<number> = new Set()
  private showSleepers = false
  private followNotice = ''
  private lastFollowChoices = ''
  private cursor = 0
  private elapsed = 0
  private paused = false
  private following: number | null = null
  private viewName = 'The city, room inside room'
  private viewPlaceId: number | null = null
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
    this.showSleepers = readShowSleepers(this.browserStorage())
    document.body.dataset['liveShowSleepers'] = String(this.showSleepers)
    const sleeperControl = document.querySelector<HTMLInputElement>('#show-sleepers')
    if (sleeperControl) sleeperControl.checked = this.showSleepers
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
      await this.loadPlaceNames()
      this.sleepers = sleepingResidents(this.replay, census)
      this.things = createThings(this.replay, this.layout)
      this.recordThingIds = recordThingIds(this.replay)
      this.handovers = createHandovers(this.replay.timeline)
      this.residents = createResidents(this.replay, census, this.layout, this.things.reservations)
      this.rooms = new RoomView(this, this.layout, this.placePlan!)
      this.updateRooms()
      addDrawingTexture(this, 'resident-default', null)
      addThingTexture(this, 'thing-default', null)
      this.drawThings()
      this.drawResidents()
      this.focusResidents()
      this.readStatus = `Read ${this.replay.map.places.length} places and ${this.replay.timeline.length} recorded events. ${this.replay.complete ? 'Recorded window loaded.' : 'This is the saved part of the window; older events are not included.'}`
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

  private async loadPlaceNames(): Promise<void> {
    if (!this.replay) return
    const initial = planPlaces(this.replay)
    const readHistory = createNameHistoryLoader()
    const histories = new Map<number, readonly NameSpan[]>()
    for (let offset = 0; offset < initial.historyPlaceIds.length; offset += 4) {
      await Promise.all(initial.historyPlaceIds.slice(offset, offset + 4).map(async id => {
        try {
          const history = await readHistory(id)
          if (history) histories.set(id, history)
        } catch (error) {
          console.error(error)
          this.thingReadIssue('Some earlier place names could not be read; unknown names stay blank.')
        }
      }))
    }
    this.placePlan = planPlaces(this.replay, histories)
    this.readIssues.push(...this.placePlan.issues)
    this.placeMoments = [...this.placePlan.foundings.values(), ...[...this.placePlan.renamings.values()].flat()]
      .map(event => event.time).sort((a, b) => a - b)
    // A founding at window_start begins unfinished even while the first drawings load.
    this.placeAnimations = [...this.placePlan.foundings.values()]
      .filter(event => event.time === this.clock?.start)
      .map(event => placeAnimation('founding', event.placeId, event.changeId, this.elapsed, this.clock!.speed))
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
    if (this.fixtureMode) {
      document.body.dataset['livePlaceDrawing'] = String(this.textures.exists('place-1'))
      document.body.dataset['livePlaceFloor'] = String(this.textures.exists('place-1'))
    }
  }

  update(_time: number, delta: number): void {
    if (!this.clock || !this.residents || !this.layout || !this.replay) return
    if (document.body.dataset['liveReady'] === 'true' && !this.paused) {
      const elapsed = Math.min(100, Math.max(0, delta))
      this.elapsed += elapsed
      // Hold the recorded moment for its walks, words and arrivals, then resume the faster clock.
      if (!this.residents.pending && !this.things?.pending && !this.handoverFrame?.pending && !this.placeAnimations.length) {
        this.clock = advanceToPlaceMoment(this.clock, elapsed, this.placeMoments)
      }
      const due = dueEvents(this.timeline, this.cursor, this.clock.time)
      this.cursor = due.cursor
      const incoming = due.events.flatMap(event => {
        const id = event.detail.place_id
        if (id === undefined) return []
        const founding = this.placePlan?.foundings.get(id)
        const rename = this.placePlan?.renamings.get(id)?.find(row => row.changeId === event.change_id)
        const kind = founding?.changeId === event.change_id ? 'founding' : rename ? 'renaming' : null
        return kind ? [placeAnimation(kind, id, event.change_id, this.elapsed, this.clock!.speed)] : []
      })
      const running = this.placeAnimations
      this.placeAnimations = stepPlaceAnimations(this.placeAnimations, incoming, this.elapsed)
      if (this.fixtureMode) this.markFinishedPlaces(running)
      this.residents = stepResidents(this.residents, due.events, elapsed, this.elapsed, this.layout, this.clock.speed)
      if (this.handovers) {
        this.handoverFrame = stepHandovers(this.handovers, due.events, this.residents, this.layout, this.elapsed, this.clock.speed)
        this.handovers = this.handoverFrame.state
      }
      if (this.things) this.things = stepThings(this.things, this.handoverFrame?.floorEvents ?? due.events, this.elapsed, this.clock.speed)
    }
    this.updateRooms()
    this.updateOutlines()
    this.drawThings()
    this.drawResidents()
    this.drawHandovers()
    this.updateHud()
  }

  // Two plain facts for the saved-fixture run to wait on: a recorded founding finished
  // laying its bricks, and a recorded renaming finished swapping its plate. An animation
  // leaves the running list only when it is done. Neither flag says when, and neither clears.
  private markFinishedPlaces(running: readonly PlaceAnimation[]): void {
    const still = new Set(this.placeAnimations.map(animation => animation.changeId))
    for (const animation of running) {
      if (still.has(animation.changeId)) continue
      if (animation.kind === 'founding') document.body.dataset['liveFoundingShown'] = 'true'
      else document.body.dataset['liveRenameShown'] = 'true'
    }
  }

  private updateRooms(): void {
    if (!this.clock || !this.layout || !this.placePlan) return
    this.hiddenPlaces = hiddenRooms(this.placePlan, this.layout, this.clock.time)
    this.contentsHidden = contentHiddenRooms(this.layout, this.hiddenPlaces, this.placeAnimations)
    this.rooms?.update(this.cameras.main, this.clock.time, this.elapsed,
      this.hiddenPlaces, this.contentsHidden, this.placeAnimations)
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
      const drawn = this.contentsHidden.has(thing.placeId) ? { ...thing, visible: false } : thing
      view.update(drawn, thing.name ?? this.thingNames.get(thing.id) ?? null, this.cameras.main.zoom, this.elapsed,
        this.handoverFrame?.carryThingIds.includes(thing.id) ?? false)
    }
    if (document.body.dataset['liveReady'] === 'true') void this.loadThingDetails()
    if (this.fixtureMode) {
      document.body.dataset['liveThings'] = JSON.stringify(Object.values(state).filter(thing => thing.visible && !this.contentsHidden.has(thing.placeId)).map(thing => ({
        id: thing.id, name: thing.name ?? this.thingNames.get(thing.id) ?? null,
      })))
      document.body.dataset['liveOutlineThing'] = String(Boolean(state[2627]?.visible))
    }
  }

  private updateOutlines(): void {
    if (!this.layout || !this.residents || !this.things || document.body.dataset['liveReady'] !== 'true') return
    for (const [id, outline] of this.outlinePending) {
      if (this.roomHasWalker(id)) continue
      this.outlinePending.delete(id)
      this.mergeOutline(outline)
    }
    const slots = 4 - this.outlineActive
    if (slots <= 0) return
    const candidates = roomsInCamera(this.layout, this.cameras.main.worldView, this.cameras.main.zoom)
      .filter(room => !this.contentsHidden.has(room.id) && !this.outlineReads.has(room.id)).slice(0, slots)
    for (const room of candidates) {
      this.outlineReads.add(room.id)
      this.outlineActive += 1
      void this.readOutline(room.id).then(outline => {
        if (!outline) {
          if (!this.fixtureMode) this.thingReadIssue('A nearby room outline was missing; its floor is kept.')
          return
        }
        if (this.contentsHidden.has(room.id)) return
        if (this.roomHasWalker(room.id)) this.outlinePending.set(room.id, outline)
        else this.mergeOutline(outline)
      }).catch(error => {
        console.error(error)
        this.thingReadIssue('Some nearby room things could not be read; their floors are kept.')
      }).finally(() => { this.outlineActive -= 1 })
    }
  }

  private roomHasWalker(placeId: number): boolean {
    return Object.values(this.residents?.residents ?? {}).some(resident => resident.walking
      && (resident.placeId === placeId || resident.destinationId === placeId))
  }

  private mergeOutline(outline: PlaceOutline): void {
    if (!this.layout || !this.residents || !this.things || this.contentsHidden.has(outline.placeId)) return
    const blockers: StageStandingSpot[] = Object.values(this.residents.residents).flatMap(resident => {
      const points = [resident.placeId === outline.placeId && resident.visible ? { key: `resident:${resident.id}`, x: resident.x, y: resident.y } : null,
        resident.destinationId === outline.placeId && resident.destination ? { key: `destination:${resident.id}`, ...resident.destination } : null]
      return points.flatMap(point => point ? [{ key: point.key, kind: 'resident' as const, x: point.x - 16, y: point.y - 16, width: 32, height: 32 }] : [])
    })
    const before = this.things
    this.things = addPresentThings(before, outline, this.layout, this.recordThingIds, blockers)
    this.residents = Object.freeze({ ...this.residents, reservations: this.things.reservations })
    for (const row of outline.things) {
      if (this.recordThingIds.has(row.id) || before.things[row.id] || !this.things.things[row.id]) continue
      this.thingReads.add(row.id)
      this.thingNames.set(row.id, row.name)
      if (row.hasDrawing) void this.loadOutlineThingDrawing(row.id)
    }
  }

  private async loadOutlineThingDrawing(id: number): Promise<void> {
    try {
      const art = await this.readThingDrawing(id)
      if (!art) return
      addThingTexture(this, `thing-${id}`, art)
      this.thingViews.get(id)?.sprite.setTexture(`thing-${id}`)
    } catch (error) {
      console.error(error)
      this.thingReadIssue('Some thing drawings could not be read; their pixel icons are kept.')
    }
  }

  private drawHandovers(): void {
    const motions = this.handoverFrame?.motions ?? []
    const keys = new Set(motions.map(motion => motion.key))
    for (const [key, view] of this.handoverViews) {
      if (!keys.has(key)) { view.destroy(); this.handoverViews.delete(key) }
    }
    for (const motion of motions) {
      let view = this.handoverViews.get(motion.key)
      if (!view) { view = new HandoverView(this); this.handoverViews.set(motion.key, view) }
      const float = this.handovers?.floats.find(item => motion.key === `transfer:${item.changeId}`)
      const carry = this.handovers?.held.find(item => motion.key === `carry:${item.plan.noticeChangeId}`)
      const carrier = carry ? this.residents?.residents[carry.plan.carrierId] : undefined
      const placeId = float?.transfer.placeId ?? carrier?.placeId
      const hidden = placeId !== null && placeId !== undefined && this.contentsHidden.has(placeId)
      view.update(hidden ? { ...motion, visible: false } : motion)
    }
    // One plain fact for the saved-fixture run to wait on: a floating copy or a carried
    // thing has been drawn at least once. It says nothing about when, and never clears.
    if (this.fixtureMode && motions.length > 0) document.body.dataset['liveHandoverShown'] = 'true'
  }

  private async loadThingDetails(): Promise<void> {
    if (this.readingThings) return
    this.readingThings = true
    try {
      for (;;) {
        const batch = Object.values(this.things?.things ?? {}).filter(thing => thing.visible
          && !this.contentsHidden.has(thing.placeId) && !this.thingReads.has(thing.id)).slice(0, 4)
        if (!batch.length) break
        for (const thing of batch) this.thingReads.add(thing.id)
        await Promise.all(batch.map(async thing => {
          // One read per thing carries both the name and whether the city has art for it.
          // A thing that says it has no drawing is never asked for one, as for residents and places.
          let hasDrawing = false
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
      const hidden = (resident.placeId !== null && this.contentsHidden.has(resident.placeId))
        || (resident.destinationId !== null && this.contentsHidden.has(resident.destinationId))
      const sleeperHidden = this.sleepers.has(resident.id) && !this.showSleepers
      figure.update(hidden || sleeperHidden ? { ...resident, visible: false } : resident, camera.zoom, this.elapsed,
        resident.id === this.following, this.sleepers.has(resident.id), this.clock?.time ?? Number.NaN)
    }
    const followed = this.following === null ? undefined : this.residents?.residents[this.following]
    if (followed && !this.isResidentDrawn(followed)) {
      const name = residentNamePlate(followed.handle) ?? 'That resident'
      const reason = this.sleepers.has(followed.id) && !this.showSleepers
        ? `${name} is hidden because sleepers are off.` : `${name} is no longer drawn.`
      this.stopFollowing(reason)
    }
    this.updateFollowChoices()
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
    document.getElementById('show-sleepers')?.addEventListener('change', event => {
      this.showSleepers = (event.target as HTMLInputElement).checked
      saveShowSleepers(this.browserStorage(), this.showSleepers)
      document.body.dataset['liveShowSleepers'] = String(this.showSleepers)
      if (!this.showSleepers && this.following !== null && this.sleepers.has(this.following)) {
        const name = residentNamePlate(this.residents?.residents[this.following]?.handle ?? '') ?? 'That resident'
        this.stopFollowing(`${name} is hidden because sleepers are off.`)
      }
      this.lastFollowChoices = ''
      this.drawResidents()
      this.updateHud()
    })
    document.getElementById('follow-open')?.addEventListener('click', () => {
      const menu = document.getElementById('follow-menu')
      const button = document.getElementById('follow-open')
      if (!menu || !button) return
      menu.hidden = !menu.hidden
      button.setAttribute('aria-expanded', String(!menu.hidden))
      if (!menu.hidden) document.querySelector<HTMLInputElement>('#follow-search')?.focus()
    })
    document.getElementById('follow-search')?.addEventListener('input', () => {
      this.lastFollowChoices = ''
      this.updateFollowChoices()
    })
    document.getElementById('follow-picker')?.addEventListener('change', event => {
      const id = Number((event.target as HTMLSelectElement).value)
      if (Number.isSafeInteger(id)) this.follow(id)
      const menu = document.getElementById('follow-menu')
      if (menu) menu.hidden = true
      document.getElementById('follow-open')?.setAttribute('aria-expanded', 'false')
    })
    document.getElementById('follow-stop')?.addEventListener('click', () => this.stopFollowing())
  }

  private zoom(factor: number): void {
    const camera = this.cameras.main
    const x = camera.midPoint.x
    const y = camera.midPoint.y
    camera.setZoom(Phaser.Math.Clamp(camera.zoom * factor, 0.005, 3)).centerOn(x, y)
  }

  private follow(id: number): void {
    const figure = this.figures.get(id)
    const resident = this.residents?.residents[id]
    if (!figure || !resident || !this.isResidentDrawn(resident)) return
    const camera = this.cameras.main
    const scrollX = camera.scrollX
    const scrollY = camera.scrollY
    this.following = id
    this.followNotice = ''
    camera.startFollow(figure.sprite, false, 0.12, 0.12)
    // Phaser centres immediately inside startFollow. Restore this frame so the following
    // frames make the visible glide instead of jumping straight to the figure.
    camera.setScroll(scrollX, scrollY)
    this.tweens.add({ targets: camera, zoom: Math.max(0.65, camera.zoom), duration: 350, ease: 'Sine.Out' })
    document.body.dataset['liveFollowing'] = String(id)
    this.updateHud()
  }

  private stopFollowing(notice = ''): void {
    this.cameras.main.stopFollow()
    this.following = null
    this.followNotice = notice
    document.body.dataset['liveFollowing'] = ''
    this.updateHud()
  }

  private isResidentDrawn(resident: Simulation['residents'][number]): boolean {
    const hiddenRoom = (resident.placeId !== null && this.contentsHidden.has(resident.placeId)) ||
      (resident.destinationId !== null && this.contentsHidden.has(resident.destinationId))
    return resident.visible && !hiddenRoom && (this.showSleepers || !this.sleepers.has(resident.id))
  }

  private updateFollowChoices(): void {
    const search = document.querySelector<HTMLInputElement>('#follow-search')?.value ?? ''
    const residents = Object.values(this.residents?.residents ?? {}).map(resident =>
      this.isResidentDrawn(resident) ? resident : { ...resident, visible: false })
    const choices = followChoices(residents, this.sleepers, this.showSleepers, search)
    const serialized = JSON.stringify(choices)
    if (serialized === this.lastFollowChoices) return
    this.lastFollowChoices = serialized
    const picker = document.querySelector<HTMLSelectElement>('#follow-picker')
    if (!picker) return
    const prompt = new Option('Choose a resident…', '', true, true)
    prompt.disabled = true
    picker.replaceChildren(prompt, ...choices.map(choice => new Option(choice.name, String(choice.id))))
  }

  private browserStorage(): Storage | null {
    try { return window.localStorage } catch { return null }
  }

  private focusResidents(): void {
    this.stopFollowing()
    if (!this.layout || !this.residents) return
    const choices = nearbyRooms(this.layout, Object.values(this.residents.residents)
      .filter(resident => this.isResidentDrawn(resident)))
      .filter(room => !this.contentsHidden.has(room.id))
    const room = choices[this.nearbyIndex++ % choices.length]
    if (!room) { this.showWholeCity(); return }
    const zoom = Math.min(0.95, (this.scale.width - 70) / (room.width + 60), (this.scale.height - 230) / (room.height + 60))
    this.cameras.main.setZoom(zoom).centerOn(room.x + room.width / 2, room.y + room.height / 2)
    this.viewPlaceId = room.id
  }

  private showWholeCity(): void {
    if (!this.layout) return
    this.stopFollowing()
    this.viewPlaceId = null
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
        ? `Following ${followed ?? 'a figure the resident list does not name'}`
        : this.viewPlaceId !== null && this.placePlan && this.layout && this.clock
          ? recordedRoomName(this.placePlan, this.layout.rooms[this.viewPlaceId]!, this.clock.time) ?? 'This room’s earlier name is not recorded.'
          : this.viewName
    }
    const followState = document.getElementById('follow-state')
    if (followState) followState.textContent = resident ? `Following ${followed ?? 'resident'} ·` : ''
    const stop = document.querySelector<HTMLButtonElement>('#follow-stop')
    if (stop) stop.hidden = !resident
    const pending = this.residents?.pending || this.things?.pending || this.handoverFrame?.pending || this.placeAnimations.length > 0
    const ended = this.clock && this.clock.time >= this.clock.end && !pending
    const failed = document.body.dataset['liveReady'] === 'error'
    const state = failed ? 'Playback is stopped; the last drawn state is kept.' : !this.clock ? ''
      : document.body.dataset['liveReady'] === 'loading' ? 'Reading resident drawings.'
      : ended ? 'Replay finished. The live feed is not connected yet.'
      : this.paused ? 'Paused.' : pending ? 'Watching a recorded moment.' : 'The clock runs faster between recorded moments.'
    const issues = [...this.readIssues, ...(this.residents?.issues ?? []), ...(this.things?.issues ?? [])]
    const sleep = this.sleepers.size ? (this.showSleepers ? 'Sleepers are shown.' : 'Sleepers are hidden.') : ''
    const status = `${this.readStatus} ${sleep} ${this.followNotice} ${state}${issues.length ? ` ${issues.join(' ')}` : ''}`.trim()
    if (status !== this.lastHud) {
      document.getElementById('status')!.textContent = status
      this.lastHud = status
    }
  }
}
