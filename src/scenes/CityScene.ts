import Phaser from 'phaser'
import { fetchReplay, fetchCensus, createDrawingLoader, createThingLoader, createNameHistoryLoader, createPlaceOutlineLoader } from '../city/api.ts'
import type { PlaceOutline, ReplayFile, Resident } from '../city/types.ts'
import { nestedLayout, type NestedLayout } from '../ground/nested.ts'
import { createClock, dueEvents, prepareTimeline, type Clock, type TimelineRow } from '../replay/index.ts'
import { createResidents, prepareLiveResidents, stepResidents, stepIdleResidents, retimeResidentWalks, roomCapacity, type Simulation } from '../replay/simulation.ts'
import { residentNamePlate } from '../city/residents.ts'
import { RoomView } from './RoomView.ts'
import { ResidentView, addDrawingTexture } from './ResidentView.ts'
import { roomsInCamera } from '../camera.ts'
import { sleepingResidents } from '../sleep.ts'
import { addPresentThings, createThings, recordThingIds, stepThings, type ThingSimulation } from '../things.ts'
import type { StageStandingSpot } from '../ground/stage-ground.ts'
import { ThingView, addThingTexture } from './ThingView.ts'
import { createHandovers, stepHandovers, type HandoverState } from '../handovers.ts'
import { HandoverLayer } from './HandoverView.ts'
import { hiddenRooms, planPlaces, recordedRoomName, type PlacePlan } from '../places.ts'
import {
  contentHiddenRooms, placeAnimation, stepPlaceAnimations, type PlaceAnimation,
} from '../place-animation.ts'
import { readShowSleepers } from '../preferences.ts'
import { createNoteExcerptLoader, fetchChanges } from '../city/changes.ts'
import { liveReadFailed, liveReadSucceeded, newLiveEvents, settleAtNow, validContinuation, wakeActiveSleepers, type LiveReadState } from '../live.ts'
import { reserveLiveThingEvents, type ThingReservations } from '../things.ts'
import { stepInventions, type InventionState } from '../inventions.ts'
import { InventionLayer } from './InventionLayer.ts'
import { createAgreementPairLoader, type AgreementPair } from '../city/agreements.ts'
import { readAgreementPairs } from '../agreements.ts'
import { AgreementLayer } from './AgreementLayer.ts'
import { browserStorage, fixtureMode, markFinishedPlaces, recordSpeechFixture, visibleFigureList } from './fixture-state.ts'
import { keepFollowedInView, MinimapView } from './MinimapView.ts'
import { refreshFollowPicker } from './follow-controls.ts'
import { updateViewControls } from './view-controls.ts'
import { SceneSound } from './SceneSound.ts'
import { cameraFrame, followActivity, focusTarget, motionSpeed, zoomAt } from '../viewer.ts'
import { currentFocusTargets } from '../focus-targets.ts'
import { connectViewerControls, connectUiVisibility, syncPlaybackControls } from './ViewerInput.ts'
import { createActivityContext, type ActivityContext } from '../activity.ts'
import { createHistoricalActivityContext } from '../activity-context.ts'
import { mountActivityLog, type ActivityLog } from './ActivityLog.ts'
import { PixelPortrait } from './PixelPortrait.ts'
import { clearThingLabels } from '../thing-labels.ts'
import { advancePresentation, playbackCommand, type PlaybackCommand } from '../playback.ts'
import { SceneHistory, type PresentationState } from './SceneHistory.ts'
import { SceneActivity } from './SceneActivity.ts'
import { readNoteWords, readPlaceDrawings, readPlacePlan, readResidentDrawings, readVisibleThingDetails } from './SceneDetails.ts'

export class CityScene extends Phaser.Scene {
  private replay?: ReplayFile
  private census: readonly Resident[] = []
  private mode: 'live' | 'replay' = 'live'
  private liveState?: LiveReadState
  private liveHistory: ReplayFile['timeline'] = []
  private liveCatchup: ReplayFile['timeline'] = []
  private liveQueue: ReplayFile['timeline'] = []
  private polling = false
  private liveReadError = false
  private liveCaughtUp = false
  private liveDeliveredMarker = 0
  private liveNotBefore = 0
  private pollGeneration = 0
  private pollTimer?: number
  private presenceReadAt = 0; private presenceReading = false; private presenceLost = false
  private jumpingLive = false
  private readonly readNote = createNoteExcerptLoader()
  private readonly readAgreement = createAgreementPairLoader()
  private agreementPairs: ReadonlyMap<string, AgreementPair> = new Map()
  private readonly agreementLayer = new AgreementLayer()
  private timeline: readonly TimelineRow[] = []
  private layout?: NestedLayout
  private residents?: Simulation
  private things?: ThingSimulation
  private handovers?: HandoverState
  private handoverFrame?: ReturnType<typeof stepHandovers>
  private readonly handoverLayer = new HandoverLayer(this)
  private inventions: InventionState = Object.freeze({ moments: [], pending: false, issues: [] }); private inventionLayer?: InventionLayer
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
  private outlineGeneration = 0
  private recordThingIds: ReadonlySet<number> = new Set()
  private clock?: Clock
  private rooms?: RoomView
  private minimap?: MinimapView
  private cameraGlide?: Phaser.Tweens.Tween
  private followSuspended = false
  private followActivityId: string | null = null
  private playbackSpeed = 1
  private readonly readResidentDrawing = createDrawingLoader()
  private readonly readPlaceDrawing = createDrawingLoader(undefined, 'place')
  private activityLog?: ActivityLog
  private activity?: SceneActivity
  private activityBase?: ActivityContext
  private historicalActivity?: ActivityContext
  private lookingAwake: ReadonlySet<number> = new Set()
  private readonly history = new SceneHistory()
  private backward = false
  private reviewingLive = false
  private readonly sounds = new SceneSound(this)
  private placePlan?: PlacePlan
  private placeAnimations: readonly PlaceAnimation[] = []
  private hiddenPlaces: ReadonlySet<number> = new Set()
  private contentsHidden: ReadonlySet<number> = new Set()
  private figures = new Map<number, ResidentView>()
  private sleepers: ReadonlySet<number> = new Set()
  private initialSleepers: ReadonlySet<number> = new Set()
  private showSleepers = false
  private lastFollowChoices = ''
  private cursor = 0
  private elapsed = 0
  private paused = true
  private following: number | null = null
  private followAcquired = false
  private viewPlaceId: number | null = null
  private readIssues: string[] = []
  private lastFigures = ''
  private readonly fixtureMode = fixtureMode()
  constructor() { super('city') }
  create(): void {
    document.body.dataset['liveReady'] = 'loading'
    document.body.dataset['liveFollowing'] = ''
    document.body.dataset['liveMode'] = 'live'
    this.showSleepers = readShowSleepers(browserStorage())
    document.body.dataset['liveShowSleepers'] = String(this.showSleepers)
    const sleeperControl = document.querySelector<HTMLInputElement>('#show-sleepers')
    if (sleeperControl) sleeperControl.checked = this.showSleepers
    this.connectControls()
    syncPlaybackControls(this.paused, this.playbackSpeed)
    this.sounds.connect()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.sounds.destroy())
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.pollGeneration += 1; window.clearTimeout(this.pollTimer); this.minimap?.destroy() })
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, connectUiVisibility())
    void this.loadCity()
  }
  private async loadCity(reads?: readonly [PromiseSettledResult<ReplayFile>, PromiseSettledResult<readonly Resident[]>]): Promise<void> {
    try {
      const [record, censusRead] = reads ?? await Promise.allSettled([fetchReplay(), fetchCensus()])
      if (record.status === 'rejected') throw record.reason
      if (reads) {
        this.pollGeneration += 1; window.clearTimeout(this.pollTimer); this.polling = false
        this.rooms?.destroy(); this.minimap?.destroy(); this.activity?.destroy(); this.activityLog?.destroy()
        this.agreementLayer.clear(); this.inventionLayer?.clear(); this.sounds.reset()
        for (const view of this.figures.values()) view.destroy()
        for (const view of this.thingViews.values()) view.destroy()
        this.handoverLayer.clear()
        this.figures.clear(); this.thingViews.clear()
        this.elapsed = 0; this.cursor = 0; this.liveHistory = []; this.liveQueue = []; this.liveCatchup = []
        this.liveCaughtUp = false; this.handoverFrame = undefined
        this.inventions = Object.freeze({ moments: [], pending: false, issues: [] })
        this.outlineReads.clear(); this.outlinePending.clear(); this.outlineGeneration += 1
      }
      const census = censusRead.status === 'fulfilled' ? censusRead.value : []
      this.census = census
      if (censusRead.status === 'rejected') {
        console.error(censusRead.reason)
        this.readIssues.push('The resident list could not be read, so figures are shown without names.')
      }
      this.replay = record.value
      this.timeline = prepareTimeline(this.replay.timeline)
      this.layout = nestedLayout(this.replay.map.places, roomCapacity(this.replay, census))
      await this.loadAgreementPairs(this.replay.timeline)
      const speed = motionSpeed(this.playbackSpeed)
      this.clock = { ...createClock(this.replay.window_start, this.replay.window_end, this.playbackSpeed), time: Date.now() }
      await this.loadPlaceNames()
      this.sleepers = sleepingResidents(this.replay, census)
      this.initialSleepers = this.sleepers
      const settled = settleAtNow(this.replay, census, this.layout, speed, this.agreementPairs)
      this.things = settled.things
      this.recordThingIds = recordThingIds(this.replay)
      this.handovers = settled.handovers
      this.residents = settled.residents
      this.connectActivityLog()
      this.activity?.reset(this.replay.timeline, this.clock.end)
      this.observeLooking(census)
      this.liveDeliveredMarker = Number(this.replay.checkpoint)
      this.liveNotBefore = Date.now()
      this.placeAnimations = []
      this.liveState = Object.freeze({ marker: this.replay.checkpoint, seen: new Set<string>(), failures: 0, lastReadAt: null, retryMs: 0 })
      this.rooms = new RoomView(this, this.layout, this.placePlan!)
      const foundingIds = new Set([...this.placePlan!.foundings.keys(), ...this.placePlan!.unresolvedFoundings])
      this.minimap = new MinimapView(this.layout, foundingIds, point => {
        this.suspendFollowing(); this.glideTo(point)
      })
      this.minimap.setVisible(false)
      this.inventionLayer = new InventionLayer(this)
      this.updateRooms()
      addDrawingTexture(this, 'resident-default', null)
      addThingTexture(this, 'thing-default', null)
      this.drawThings()
      this.drawResidents()
      this.history.reset(this.presentationState())
      if (!reads) this.showWholeCity()
      else if (this.following !== null) this.follow(this.following)
      this.updateHud()
      await this.loadDrawings(census)
      document.body.dataset['liveReady'] = censusRead.status === 'fulfilled' ? 'true' : 'error'
      this.updateHud()
      void this.loadPlaceDrawings()
      void this.loadThingDetails()
      void this.pollLive()
    } catch (error) {
      // The reader's own words help nobody reading the page; the console keeps them.
      console.error(error)
      this.readIssues.push('The public record could not be read.')
      document.body.dataset['liveReady'] = 'error'
      this.updateHud()
    }
  }
  private connectActivityLog(): void {
    if (!this.replay || !this.placePlan || !this.layout) return
    const context = createActivityContext(this.census, this.replay.map.places, (place, time) =>
      hiddenRooms(this.placePlan!, this.layout!, time).has(place.id) ? null : recordedRoomName(this.placePlan!, place, time))
    const residents = context.resident
    const dynamic = { ...context, resident: (actor: string) => {
      const known = residents(actor)
      if (known) return known
      const id = this.residents?.actors.get(actor)
      return id === undefined ? null : { type: 'resident' as const, id, name: actor, hasDrawing: false }
    }, actorRoom: (actor: string, time: number) => this.historicalActivity?.actorRoom?.(actor, time) ?? null,
    thing: (id: number, time: number) => this.historicalActivity?.thing?.(id, time) ?? null,
    effect: (id: number, time: number) => this.historicalActivity?.effect?.(id, time) ?? null }
    this.activityBase = context
    this.historicalActivity = createHistoricalActivityContext(this.replay, this.census, context)
    const portraits = new PixelPortrait({ residentDrawing: this.readResidentDrawing, placeDrawing: this.readPlaceDrawing,
      thing: this.readThing, thingDrawing: this.readThingDrawing })
    this.activityLog = mountActivityLog(dynamic, portraits)
    this.activity = new SceneActivity(this, this.activityLog, dynamic)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.activityLog?.destroy())
  }
  private async loadPlaceNames(): Promise<void> {
    if (!this.replay) return
    this.placePlan = await readPlacePlan(this.replay, createNameHistoryLoader(), message => this.thingReadIssue(message))
    this.readIssues.push(...this.placePlan.issues)
  }
  private async loadDrawings(census: readonly Resident[]): Promise<void> {
    await readResidentDrawings(census, this.residents?.residents ?? {}, this.readResidentDrawing, (id, art) => {
      addDrawingTexture(this, `resident-${id}`, art); this.figures.get(id)?.sprite.setTexture(`resident-${id}`)
    }, message => this.thingReadIssue(message))
  }
  private async loadPlaceDrawings(): Promise<void> {
    if (!this.layout || !this.replay) return
    await readPlaceDrawings(this.replay, this.layout, this.readPlaceDrawing, (id, art) => this.rooms?.addDrawing(this, id, art),
      message => this.thingReadIssue(message))
    if (this.fixtureMode) {
      document.body.dataset['livePlaceDrawing'] = String(this.textures.exists('place-1'))
      document.body.dataset['livePlaceFloor'] = String(this.textures.exists('place-1'))
    }
  }
  update(_time: number, delta: number): void {
    if (!this.clock || !this.residents || !this.layout || !this.replay) return
    if (document.body.dataset['liveReady'] === 'true' && !this.paused && !this.jumpingLive) {
      const elapsed = Math.min(100, Math.max(0, delta))
      if (this.backward) {
        const frame = this.history.rewind(elapsed)
        if (frame) this.restorePresentation(frame)
        if (!this.history.canRewind) this.paused = true
      } else {
      this.elapsed += elapsed
      if (this.mode === 'live') {
        this.placeAnimations = stepPlaceAnimations(this.placeAnimations, [], this.elapsed)
        if (!this.residents.pending && !this.things?.pending && !this.handoverFrame?.pending && this.liveQueue.length) {
          const firstAt = Date.parse(this.liveQueue[0]!.at)
          const incoming = this.liveQueue.filter(row => Date.parse(row.at) === firstAt)
          this.liveQueue = this.liveQueue.slice(incoming.length)
          this.clock = { ...this.clock, time: firstAt }
          this.liveDeliveredMarker = Math.max(this.liveDeliveredMarker, ...incoming.map(row => Number(row.change_id)))
          this.prepareLiveEvents(incoming)
          this.applyEvents(incoming, elapsed)
        } else { this.applyEvents([], elapsed); if (!this.residents.pending && !this.liveQueue.length) {
          this.clock = { ...this.clock, time: Date.now() }; this.reviewingLive = false
        } }
      } else {
      // Hold the recorded moment for its walks, words and arrivals, then resume the faster clock.
      this.clock = advancePresentation(this.clock, elapsed,
        this.residents.pending || Boolean(this.things?.pending) || Boolean(this.handoverFrame?.pending) || this.placeAnimations.length > 0,
        this.timeline[this.cursor]?.time ?? null)
      const due = dueEvents(this.timeline, this.cursor, this.clock.time)
      this.cursor = due.cursor
      const incoming = due.events.flatMap(event => {
        const id = event.detail.place_id
        if (id === undefined) return []
        const founding = this.placePlan?.foundings.get(id)
        const rename = this.placePlan?.renamings.get(id)?.find(row => row.changeId === event.change_id)
        const kind = founding?.changeId === event.change_id ? 'founding' : rename ? 'renaming' : null
        return kind ? [placeAnimation(kind, id, event.change_id, this.elapsed, motionSpeed(this.clock!.speed))] : []
      })
      const running = this.placeAnimations
      this.placeAnimations = stepPlaceAnimations(this.placeAnimations, incoming, this.elapsed)
      if (this.fixtureMode) markFinishedPlaces(running, this.placeAnimations)
      this.applyEvents(due.events, elapsed)
      const finished = this.clock.time >= this.clock.end && !this.residents.pending && !this.things?.pending
        && !this.handoverFrame?.pending && !this.placeAnimations.length && this.cursor >= this.timeline.length
      if (finished) this.enterLiveMode()
      }
      this.residents = stepIdleResidents(this.residents, elapsed, this.elapsed, this.layout, this.sleepers, row => this.isResidentDrawn(row))
      this.history.record(this.presentationState())
      }
    }
    this.updateRooms()
    if (!this.backward && !this.history.rewound) void this.readLooking()
    this.lookingAwake = this.activity?.activeLookingIds(Date.now()) ?? new Set()
    if (!this.backward && !this.history.rewound) this.updateOutlines()
    this.drawThings()
    this.drawResidents()
    this.updateFollowCamera()
    this.sounds.update(this.elapsed, this.paused || this.backward || this.history.rewound, this.residents, this.figures, this.placeAnimations, this.layout, this.cameras.main)
    this.minimap?.update(this.cameras.main, this.following === null ? null : this.figures.get(this.following)?.sprite ?? null, this.contentsHidden)
    this.drawHandovers()
    this.activity?.update(Object.fromEntries(Object.values(this.residents.residents).filter(row => this.isResidentDrawn(row)).map(row => [row.id, row])),
      this.things?.things ?? {}, this.layout, this.contentsHidden, this.elapsed, this.cameras.main.zoom,
      this.mode === 'live' && !this.backward && !this.history.rewound ? Date.now() : undefined)
    this.inventionLayer?.update(this.inventions, this.residents, this.contentsHidden, this.cameras.main.zoom)
    if (this.fixtureMode) document.body.dataset['liveInventions'] = String(this.inventions.moments.length)
    this.updateHud()
  }
  private async pollLive(): Promise<void> {
    if (this.polling || !this.liveState) return
    this.polling = true
    const generation = this.pollGeneration
    let delay = 15_000
    try {
      const page = await fetchChanges(this.liveState.marker)
      if (generation !== this.pollGeneration) return
      if (!validContinuation(this.liveState.marker, page.nextSince, page.hasMore)) {
        throw new Error('The changes continuation did not advance.')
      }
      const fresh = newLiveEvents(this.liveState, page.events)
      const enriched = await this.enrichNotes(fresh)
      await this.loadAgreementPairs(enriched)
      if (generation !== this.pollGeneration) return
      this.liveState = liveReadSucceeded(this.liveState, page.nextSince, enriched, Date.now())
      this.liveReadError = false
      if (enriched.length) {
        this.liveCatchup = Object.freeze([...this.liveCatchup, ...enriched])
      }
      if (!page.hasMore) {
        const known = new Set(this.liveHistory.map(row => row.change_id))
        const completed = this.liveCatchup.filter(row => !known.has(row.change_id))
        this.liveHistory = Object.freeze([...this.liveHistory, ...completed])
        if (this.mode === 'live') this.liveQueue = Object.freeze([...this.liveQueue,
          ...completed.filter(row => Date.parse(row.at) > this.liveNotBefore)])
        this.liveCatchup = []
        this.liveCaughtUp = true
      }
      delay = page.hasMore ? 0 : this.liveState.retryMs ?? 15_000
      if (this.fixtureMode) document.body.dataset['livePoll'] = 'true'
    } catch (error) {
      console.error(error)
      this.liveState = liveReadFailed(this.liveState)
      this.liveReadError = true
      delay = this.liveState.retryMs ?? 30_000
    } finally {
      if (generation === this.pollGeneration) {
        this.polling = false
        this.updateHud()
        window.clearTimeout(this.pollTimer)
        this.pollTimer = window.setTimeout(() => void this.pollLive(), delay)
      }
    }
  }
  private async enrichNotes(events: readonly ReplayFile['timeline'][number][]): Promise<readonly ReplayFile['timeline'][number][]> {
    return this.layout ? readNoteWords(events, this.layout, this.readNote, message => this.thingReadIssue(message)) : events
  }
  private async loadAgreementPairs(events: readonly ReplayFile['timeline'][number][]): Promise<void> {
    const result = await readAgreementPairs(events, this.readAgreement, this.agreementPairs)
    this.agreementPairs = result.pairs; if (result.failed) this.thingReadIssue('Some agreement parties could not be read; those signatures could not be shown.')
  }
  private prepareLiveEvents(events: readonly ReplayFile['timeline'][number][]): void {
    if (!this.layout || !this.residents || !this.things || !this.replay) return
    const blockers: Record<number, StageStandingSpot[]> = {}
    for (const resident of Object.values(this.residents.residents)) {
      const points = [resident.placeId !== null && resident.visible ? { placeId: resident.placeId, key: `resident:${resident.id}`, x: resident.x, y: resident.y } : null,
        resident.destinationId !== null && resident.destination ? { placeId: resident.destinationId, key: `destination:${resident.id}`, ...resident.destination } : null]
      for (const point of points) if (point) (blockers[point.placeId] ??= []).push({ key: point.key, kind: 'resident', x: point.x - 16, y: point.y - 16, width: 32, height: 32 })
    }
    this.things = reserveLiveThingEvents(this.things, events, this.layout, blockers as ThingReservations)
    this.residents = prepareLiveResidents(Object.freeze({ ...this.residents, reservations: this.things.reservations }), events)
    this.handovers = createHandovers([...this.replay.timeline, ...this.liveHistory])
    this.recordThingIds = recordThingIds({ ...this.replay, timeline: [...this.replay.timeline, ...this.liveHistory] })
    const latest = Math.max(Date.now(), ...this.liveHistory.map(row => Date.parse(row.at)))
    const extended = { ...this.replay, window_end: new Date(latest).toISOString(),
      timeline: [...this.replay.timeline, ...this.liveHistory] }
    this.placePlan = planPlaces(extended, this.placePlan?.names)
    if (this.activityBase) this.historicalActivity = createHistoricalActivityContext(extended, this.census, this.activityBase)
    this.rooms?.setPlan(this.placePlan)
    for (const issue of this.placePlan.issues) if (!this.readIssues.includes(issue)) this.readIssues.push(issue)
    for (const event of events) {
      const id = event.detail.place_id
      if (typeof id !== 'number' || !this.layout.rooms[id]) continue
      const founding = this.placePlan.foundings.get(id)
      const rename = this.placePlan.renamings.get(id)?.find(row => row.changeId === event.change_id)
      const kind = founding?.changeId === event.change_id ? 'founding' : rename ? 'renaming' : null
      if (kind) this.placeAnimations = stepPlaceAnimations(this.placeAnimations,
        [placeAnimation(kind, id, event.change_id, this.elapsed, motionSpeed(this.playbackSpeed))], this.elapsed)
    }
    this.sleepers = wakeActiveSleepers(this.sleepers, this.residents.residents, events)
  }
  private replayDay(): void {
    if (!this.replay || !this.layout) return
    this.suspendFollowing()
    this.mode = 'replay'
    this.reviewingLive = false
    this.paused = false
    this.backward = false
    syncPlaybackControls(this.paused, this.playbackSpeed)
    this.clock = createClock(this.replay.window_start, this.replay.window_end,
      this.playbackSpeed)
    this.activity?.reset([], this.clock.start)
    this.lookingAwake = new Set()
    this.timeline = prepareTimeline(this.replay.timeline)
    this.cursor = 0
    this.elapsed = 0
    this.placeAnimations = [...(this.placePlan?.foundings.values() ?? [])]
      .filter(event => event.time === this.clock!.start)
      .map(event => placeAnimation('founding', event.placeId, event.changeId, 0, motionSpeed(this.clock!.speed)))
    this.things = createThings(this.replay, this.layout)
    this.residents = createResidents(this.replay, this.census, this.layout, this.things.reservations)
    this.handovers = createHandovers(this.replay.timeline)
    this.handoverFrame = undefined
    this.inventions = Object.freeze({ moments: [], pending: false, issues: [] }); this.inventionLayer?.clear()
    this.agreementLayer.clear()
    this.sounds.reset()
    this.liveQueue = []
    this.liveDeliveredMarker = Number(this.replay.checkpoint)
    this.outlineReads.clear()
    this.outlinePending.clear()
    this.outlineGeneration += 1
    this.sleepers = this.initialSleepers
    this.history.reset(this.presentationState())
    document.body.dataset['liveMode'] = 'replay'
    this.updateHud()
  }
  private enterLiveMode(): void {
    this.mode = 'live'
    if (this.clock) this.clock = { ...this.clock, time: Date.now() }
    this.liveQueue = Object.freeze([...this.liveHistory])
    document.body.dataset['liveMode'] = 'live'
    this.updateHud()
  }
  private applyEvents(events: readonly ReplayFile['timeline'][number][], elapsed: number): void {
    if (!this.layout || !this.residents || !this.things || !this.handovers || !this.clock) return
    this.residents = stepResidents(this.residents, events, elapsed, this.elapsed, this.layout, this.clock.speed, this.agreementPairs, row => this.isResidentDrawn(row))
    this.agreementLayer.add(this.residents.startedHandshakes ?? [])
    this.inventions = stepInventions(this.inventions, this.residents.startedInventions ?? [], this.residents,
      this.contentsHidden, this.elapsed)
    this.handoverFrame = stepHandovers(this.handovers, events, this.residents, this.layout, this.elapsed, motionSpeed(this.clock.speed))
    this.handovers = this.handoverFrame.state
    this.things = stepThings(this.things, this.handoverFrame.floorEvents, this.elapsed, motionSpeed(this.clock.speed))
    const started = this.residents.startedEvents ?? []
    const represented = new Set(started.filter(event => {
      const id = event.actor ? this.residents!.actors.get(event.actor.trim()) : undefined
      const actor = id === undefined ? undefined : this.residents!.residents[id]
      return actor?.walkEventId === event.change_id && actor.walking
        || event.kind === 'note' && (actor?.bubble?.noteId === event.detail.note_id || Boolean(actor?.showingNotice))
        || actor?.lastActivityId === event.change_id && Boolean(actor?.sparkle || actor?.inventionUntil || actor?.agreementUntil || actor?.transferUntil || actor?.blockedAttempt)
        || Boolean(this.things!.things[Number(event.detail.thing_id ?? event.detail.source_thing_id)]?.effect)
        || this.placeAnimations.some(row => row.changeId === event.change_id)
    }).map(event => event.change_id))
    this.activity?.consume([...started, ...events.filter(event => !event.actor)], this.clock.time, this.elapsed, represented)
  }
  private observeLooking(census: readonly Resident[]): void {
    const places = new Map(Object.values(this.residents?.residents ?? {}).flatMap(row => row.placeId === null ? [] : [[row.id, row.placeId] as const]))
    this.activity?.observeLooking(census, Date.now(), !this.presenceLost && this.mode === 'live' && !this.paused && !this.backward
      && !this.history.rewound && this.liveQueue.length === 0, places, this.contentsHidden, this.elapsed)
    this.presenceReadAt = Date.now() + 30_000
  }
  private async readLooking(): Promise<void> {
    if (this.presenceReading || this.backward || this.history.rewound || this.reviewingLive || Date.now() < this.presenceReadAt) return
    this.presenceReading = true; const generation = this.pollGeneration
    this.presenceReadAt = Date.now() + 30_000
    try { const census = await fetchCensus(); if (generation === this.pollGeneration && !this.backward && !this.history.rewound && !this.reviewingLive) { this.observeLooking(census); this.presenceLost = false } }
    catch (error) { console.error(error); this.presenceLost = true; this.presenceReadAt = Date.now() + 60_000 }
    finally { this.presenceReading = false }
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
    const zoom = this.cameras.main.zoom
    const clear = clearThingLabels(Object.values(state).filter(thing => thing.visible && !this.contentsHidden.has(thing.placeId)
      && !this.handoverFrame?.carryThingIds.includes(thing.id)).map(thing => ({ id: thing.id, x: thing.x * zoom, y: (thing.y + 17) * zoom })),
    Object.values(this.residents?.residents ?? {}).filter(resident => this.isResidentDrawn(resident))
      .map(resident => ({ x: resident.x * zoom, y: resident.y * zoom })))
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
        this.handoverFrame?.carryThingIds.includes(thing.id) ?? false, clear.has(thing.id))
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
    if (this.mode !== 'live' || !this.liveCaughtUp || !this.layout || !this.residents || !this.things || document.body.dataset['liveReady'] !== 'true') return
    for (const [id, outline] of this.outlinePending) {
      if (this.roomHasMotion(id)) continue
      this.outlinePending.delete(id)
      this.mergeOutline(outline)
    }
    const slots = 4 - this.outlineActive
    if (slots <= 0) return
    const candidates = roomsInCamera(this.layout, this.cameras.main.worldView, this.cameras.main.zoom)
      .filter(room => !this.contentsHidden.has(room.id) && !this.outlineReads.has(room.id)).slice(0, slots)
    for (const room of candidates) {
      const generation = this.outlineGeneration
      this.outlineReads.add(room.id)
      this.outlineActive += 1
      void this.readOutline(room.id).then(outline => {
        if (generation !== this.outlineGeneration) return
        if (!outline) {
          if (!this.fixtureMode) this.thingReadIssue('A nearby room outline was missing; its floor is kept.')
          return
        }
        if (this.contentsHidden.has(room.id)) return
        if (this.roomHasMotion(room.id)) this.outlinePending.set(room.id, outline)
        else this.mergeOutline(outline)
      }).catch(error => {
        console.error(error)
        this.thingReadIssue('Some nearby room things could not be read; their floors are kept.')
      }).finally(() => { this.outlineActive -= 1 })
    }
  }
  private roomHasMotion(placeId: number): boolean {
    return Object.values(this.residents?.residents ?? {}).some(resident => (resident.walking || resident.agreementUntil != null)
      && (resident.placeId === placeId || resident.destinationId === placeId))
  }
  private mergeOutline(outline: PlaceOutline): void {
    if (this.backward || this.history.rewound || this.mode !== 'live' || !this.layout || !this.residents || !this.things || this.contentsHidden.has(outline.placeId)) return
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
    this.handoverLayer.update(this.handoverFrame, this.handovers, this.residents, this.contentsHidden)
    if (this.fixtureMode && this.handoverFrame?.motions.length) document.body.dataset['liveHandoverShown'] = 'true'
  }
  private async loadThingDetails(): Promise<void> {
    if (this.readingThings) return
    this.readingThings = true
    try { await readVisibleThingDetails(this.things?.things ?? {}, this.contentsHidden, this.thingReads, this.readThing, this.readThingDrawing,
      (id, name) => this.thingNames.set(id, name), (id, art) => { addThingTexture(this, `thing-${id}`, art); this.thingViews.get(id)?.sprite.setTexture(`thing-${id}`) },
      message => this.thingReadIssue(message)) } finally { this.readingThings = false }
  }
  private thingReadIssue(message: string): void {
    if (!this.readIssues.includes(message)) this.readIssues.push(message)
  }
  private drawResidents(): void {
    const camera = this.cameras.main
    const state = this.residents?.residents ?? {}
    let visibleSpeech: { residentId: number; text: string; shape: string; showing: string } | null = null
    for (const [id, figure] of this.figures) if (!state[id]) {
      figure.destroy()
      this.figures.delete(id)
    }
    const projected = this.agreementLayer.project(this.elapsed)
    for (const resident of Object.values(state)) {
      let figure = this.figures.get(resident.id)
      if (!figure) {
        figure = new ResidentView(this, resident)
        if (this.textures.exists(`resident-${resident.id}`)) figure.sprite.setTexture(`resident-${resident.id}`)
        this.figures.set(resident.id, figure)
      }
      const hidden = (resident.placeId !== null && this.contentsHidden.has(resident.placeId))
        || (resident.destinationId !== null && this.contentsHidden.has(resident.destinationId))
      const sleeping = this.sleepers.has(resident.id) && !this.lookingAwake.has(resident.id)
      const sleeperHidden = sleeping && !this.showSleepers
      const point = projected.get(resident.id)
      const displayed = point ? { ...resident, x: point.x, y: point.y } : resident
      const speech = figure.update(hidden || sleeperHidden ? { ...displayed, visible: false } : displayed, camera.zoom, this.elapsed,
        resident.id === this.following, sleeping, this.clock?.time ?? Number.NaN, this.replay?.map.places)
      if (speech && (visibleSpeech === null || speech.residentId === this.following)) visibleSpeech = speech
    }
    this.agreementLayer.draw(this, this.figures, this.contentsHidden)
    recordSpeechFixture(visibleSpeech, this.fixtureMode, this.agreementLayer.count)
    const followed = this.following === null ? undefined : this.residents?.residents[this.following]
    if (followed && !this.isResidentDrawn(followed) && !this.followSuspended) this.suspendFollowing()
    this.updateFollowChoices()
    if (!this.fixtureMode) return
    const listed = visibleFigureList(this.figures, camera, this.scale.width, this.scale.height)
    if (listed === this.lastFigures) return
    this.lastFigures = listed
    document.body.dataset['liveFigures'] = listed
  }
  private connectControls(): void {
    connectViewerControls(this, { browse: () => this.suspendFollowing(), follow: id => this.follow(id),
      zoom: (factor, anchor) => this.zoom(factor, anchor), trust: event => this.sounds.trust(event),
      playback: command => this.controlPlayback(command), live: () => void this.goLive(), replay: () => this.replayDay(),
      city: () => this.showWholeCity(), focus: () => this.focusResidents(), stop: () => this.stopFollowing(),
      minimap: shown => this.minimap?.setVisible(shown), sleepers: shown => {
        this.showSleepers = shown
        if (!shown && this.following !== null && this.sleepers.has(this.following)) this.suspendFollowing()
        this.lastFollowChoices = ''; this.drawResidents(); this.updateHud()
      } })
  }
  private zoom(factor: number, anchor?: { x: number; y: number }): void {
    this.suspendFollowing()
    const camera = this.cameras.main
    const frame = zoomAt(camera, camera.zoom * factor, anchor ?? { x: camera.width / 2, y: camera.height / 2 })
    camera.setZoom(frame.zoom).centerOn(frame.x, frame.y)
  }
  private follow(id: number): void {
    const figure = this.figures.get(id)
    const resident = this.residents?.residents[id]
    if (!figure || !resident || !this.isResidentDrawn(resident)) return
    this.cameraGlide?.stop(); this.cameraGlide = undefined
    this.following = id
    this.followSuspended = false
    this.followActivityId = this.residentActivity(id)
    this.followAcquired = false
    this.glideTo(figure.sprite, Math.max(0.65, this.cameras.main.zoom))
    document.body.dataset['liveFollowing'] = String(id)
    this.updateHud()
  }
  private stopFollowing(): void {
    this.cameraGlide?.stop(); this.cameraGlide = undefined
    this.tweens.killTweensOf(this.cameras.main)
    this.cameras.main.stopFollow()
    this.following = null
    this.followAcquired = false
    this.followSuspended = false
    document.body.dataset['liveFollowing'] = ''
    this.updateHud()
  }
  private suspendFollowing(): void {
    this.cameraGlide?.stop(); this.cameraGlide = undefined
    this.followSuspended = true
    this.followActivityId = this.following === null ? null : this.residentActivity(this.following)
    this.followAcquired = false
    document.body.dataset['liveFollowSuspended'] = 'true'
  }
  private isResidentDrawn(resident: Simulation['residents'][number]): boolean {
    const hiddenRoom = (resident.placeId !== null && this.contentsHidden.has(resident.placeId)) ||
      (resident.destinationId !== null && this.contentsHidden.has(resident.destinationId))
    return resident.visible && !hiddenRoom && (this.showSleepers || !this.sleepers.has(resident.id) || this.lookingAwake.has(resident.id))
  }
  private updateFollowCamera(): void {
    if (this.following === null) return
    const figure = this.figures.get(this.following)
    const resident = this.residents?.residents[this.following]
    if (!figure || !resident || !this.isResidentDrawn(resident)) return
    if (this.backward || this.history.rewound) return
    const activityId = this.residentActivity(resident.id)
    const next = followActivity({ residentId: this.following, suspended: this.followSuspended, activityId: this.followActivityId },
      resident.id, activityId)
    if ((this.followSuspended && !next.suspended) || (!this.followSuspended
      && this.followActivityId !== next.activityId && resident.relocatedAt === this.elapsed)) this.glideTo(figure.sprite)
    this.followSuspended = next.suspended; this.followActivityId = next.activityId
    document.body.dataset['liveFollowSuspended'] = String(this.followSuspended)
    if (this.followSuspended || this.cameraGlide) return
    this.followAcquired = keepFollowedInView(this.cameras.main, figure.sprite, this.followAcquired)
  }
  private updateFollowChoices(): void {
    this.lastFollowChoices = refreshFollowPicker(this.residents?.residents ?? {}, this.sleepers, this.showSleepers,
      this.lastFollowChoices, resident => this.isResidentDrawn(resident), this.following)
  }
  private focusResidents(): void {
    this.suspendFollowing()
    if (!this.layout || !this.residents) return
    const candidates = currentFocusTargets(this.residents.residents, this.things?.things ?? {}, this.placeAnimations, this.layout,
      row => this.isResidentDrawn(row), this.contentsHidden, this.hiddenPlaces,
      (this.activity?.focusCandidates() ?? []).map(id => ({ id, startedAt: this.activity?.latestActivity(id)?.startedAt ?? 0 })))
    const target = focusTarget(candidates)
    if (!target) return
    this.viewPlaceId = target.roomId
    this.glideTo(target, Math.max(0.65, this.cameras.main.zoom))
  }
  private glideTo(target: { x: number; y: number }, zoom = this.cameras.main.zoom): void {
    this.cameraGlide?.stop()
    const camera = this.cameras.main; const view = cameraFrame(camera)
    const point = { x: view.x + view.width / 2, y: view.y + view.height / 2, zoom: camera.zoom }
    this.cameraGlide = this.tweens.add({ targets: point, zoom: Math.max(0.005, camera.zoom * 0.82), duration: 240,
      ease: 'Sine.InOut', onUpdate: () => camera.setZoom(point.zoom).centerOn(point.x, point.y), onComplete: () => {
        this.cameraGlide = this.tweens.add({ targets: point, x: target.x, y: target.y, zoom, duration: 1400,
          ease: 'Sine.InOut', onUpdate: () => camera.setZoom(point.zoom).centerOn(point.x, point.y),
          onComplete: () => { this.cameraGlide = undefined; this.followAcquired = false } })
      } })
  }
  private showWholeCity(): void {
    if (!this.layout) return
    this.suspendFollowing()
    this.viewPlaceId = null
    this.cameras.main.setZoom(Math.min((this.scale.width - 40) / this.layout.width, (this.scale.height - 210) / this.layout.height))
      .centerOn(this.layout.width / 2, this.layout.height / 2)
  }
  private presentationState(): PresentationState {
    return { clock: this.clock!, residents: this.residents!, things: this.things!, handovers: this.handovers!,
      handoverFrame: this.handoverFrame, inventions: this.inventions, placeAnimations: this.placeAnimations,
      elapsed: this.elapsed, cursor: this.cursor, mode: this.mode, liveDeliveredMarker: this.liveDeliveredMarker,
      sleepers: this.sleepers, agreements: this.agreementLayer.snapshot(), activity: this.activity?.snapshot() }
  }
  private residentActivity(id: number): string | null {
    const recent = this.activity?.latestActivity(id)
    return recent?.key.startsWith('looking:') ? recent.key : this.residents?.residents[id]?.lastActivityId ?? null
  }
  private restorePresentation(frame: PresentationState): void {
    this.clock = { ...frame.clock, speed: this.playbackSpeed }; this.residents = frame.residents; this.things = frame.things
    this.handovers = frame.handovers; this.handoverFrame = frame.handoverFrame; this.inventions = frame.inventions
    this.placeAnimations = frame.placeAnimations; this.elapsed = frame.elapsed; this.cursor = frame.cursor; this.mode = frame.mode
    this.liveDeliveredMarker = frame.liveDeliveredMarker; this.sleepers = frame.sleepers
    this.agreementLayer.restore(frame.agreements)
    if (frame.activity) this.activity?.restore(frame.activity)
    document.body.dataset['liveMode'] = 'replay'
  }
  private controlPlayback(command: PlaybackCommand): void {
    if (!this.residents || !this.layout || !this.clock || this.jumpingLive) return
    if (command === 'rewind') {
      if (!this.history.rewound) this.history.record(this.presentationState(), true)
      if (!this.history.canRewind) return
      this.sounds.stop(); this.suspendFollowing()
      this.reviewingLive = this.mode === 'live'
    } else if (command !== 'pause' && this.history.rewound) {
      this.history.resume(); this.activity?.resume(Date.now()); this.suspendFollowing()
      if (this.mode === 'live') this.liveQueue = this.liveHistory.filter(row => Number(row.change_id) > this.liveDeliveredMarker)
    }
    const next = playbackCommand({ paused: this.paused, speed: this.playbackSpeed, direction: this.backward ? 'backward' : 'forward' }, command)
    this.paused = next.paused; this.playbackSpeed = next.speed; this.backward = next.direction === 'backward'
    this.clock = { ...this.clock, speed: this.playbackSpeed }
    if (command === 'normal' || command === 'fast') this.residents = retimeResidentWalks(this.residents, this.playbackSpeed, this.layout)
    if (this.paused) this.sounds.stop()
    document.body.dataset['liveMode'] = this.backward || this.history.rewound ? 'replay' : this.mode
    this.updateHud()
  }
  private async goLive(): Promise<void> {
    if (this.jumpingLive) return
    this.jumpingLive = true; this.sounds.stop()
    try {
      const reads = await Promise.allSettled([fetchReplay(), fetchCensus()])
      if (reads[0].status === 'rejected') throw reads[0].reason
      if (reads[1].status === 'rejected') throw reads[1].reason
      this.mode = 'live'; this.backward = false; this.paused = false; this.reviewingLive = false
      await this.loadCity(reads)
      document.body.dataset['liveMode'] = 'live'
    } catch (error) { console.error(error); this.liveReadError = true }
    finally { this.jumpingLive = false; this.updateHud() }
  }
  private updateHud(): void {
    const mode = this.history.rewound || this.reviewingLive || this.backward ? 'replay' : this.mode
    syncPlaybackControls(this.paused, this.playbackSpeed, this.backward, mode, this.history.canRewind)
    document.body.dataset['liveMode'] = mode
    const time = document.getElementById('clock')
    if (time && this.clock) {
      time.textContent = `${new Date(this.clock.time).toISOString().slice(11, 19)} UTC`
      time.title = new Date(this.clock.time).toISOString()
      time.setAttribute('datetime', new Date(this.clock.time).toISOString())
    }
    const resident = this.following === null ? undefined : this.residents?.residents[this.following]
    const followed = resident ? residentNamePlate(resident.handle) : null
    updateViewControls({
      followed: resident ? followed : undefined, plan: this.placePlan, time: this.clock?.time, overview: '',
      place: this.viewPlaceId === null ? undefined : this.layout?.rooms[this.viewPlaceId] })
    document.body.dataset['liveReadError'] = String(this.liveReadError)
  }
}
