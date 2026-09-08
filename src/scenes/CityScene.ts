import Phaser from 'phaser'
import { fetchReplay, fetchCensus, createDrawingLoader, createThingLoader, createNameHistoryLoader, createPlaceOutlineLoader } from '../city/api.ts'
import type { PlaceOutline, ReplayFile, Resident } from '../city/types.ts'
import { nestedLayout, type NestedLayout } from '../ground/nested.ts'
import { createClock, dueEvents, prepareTimeline, type Clock, type TimelineRow } from '../replay/index.ts'
import { blocksLiveDelivery, createResidents, prepareLiveResidents, stepResidents, roomCapacity, type Simulation } from '../replay/simulation.ts'
import { RoomView } from './RoomView.ts'
import { ResidentView, addDrawingTexture } from './ResidentView.ts'
import { sleepingResidents, sleepTransitions } from '../sleep.ts'
import { sleepActivityEntries } from '../sleep-activity.ts'
import { addPresentThings, createThings, recordThingIds, stepThings, type ThingSimulation } from '../things.ts'
import type { StageStandingSpot } from '../ground/stage-ground.ts'
import { ThingView, addThingTexture } from './ThingView.ts'
import { blocksLiveHandoverDelivery, createHandovers, stepHandovers, type HandoverState } from '../handovers.ts'
import { HandoverLayer } from './HandoverView.ts'
import { hiddenRooms, planPlaces, recordedRoomName, type PlacePlan } from '../places.ts'
import { contentHiddenRooms, placeAnimation, stepPlaceAnimations, type PlaceAnimation } from '../place-animation.ts'
import { createNoteExcerptLoader, fetchChanges } from '../city/changes.ts'
import { liveReadFailed, liveReadSucceeded, newLiveEvents, settleAtNow, validContinuation, type LiveReadState } from '../live.ts'
import { reserveLiveThingEvents, type ThingReservations } from '../things.ts'
import { stepInventions, type InventionState } from '../inventions.ts'
import { InventionLayer } from './InventionLayer.ts'
import { createAgreementPairLoader, type AgreementPair } from '../city/agreements.ts'
import { readAgreementPairs } from '../agreements.ts'
import { AgreementLayer } from './AgreementLayer.ts'
import { fixtureMode, markFinishedPlaces, recordSpeechFixture } from './fixture-state.ts'
import { SceneSound } from './SceneSound.ts'
import { motionSpeed } from '../viewer.ts'
import { createActivityContext, type ActivityContext } from '../activity.ts'
import { createHistoricalActivityContext } from '../activity-context.ts'
import { advancePresentation } from '../playback.ts'
import { residentReservationFootprint } from '../resident-footprint.ts'
import { SceneHistory, type PresentationState } from './SceneHistory.ts'
import { SceneActivity } from './SceneActivity.ts'
import { readInitialNoteWords, readNoteWords, readPlacePlan, readResidentDrawings, readVisibleThingDetails } from './SceneDetails.ts'

import { busiestRoom, singleRoomLayout, roomViewportUsable, roomIsPublic } from '../room-view.ts'
import { RoomActivityLine } from './RoomActivityLine.ts'
import { animationDelta, eventsAfterMarker, roomPictureSettled, roomPictureAccess, roomStatus, type OutlineResolution } from '../live-presentation.ts'
import { presentRoom, roomFigurePriority } from '../room-presentation.ts'
import { roomLabelFitsViewport, visibleRoomLabels, type RoomCrowdingState } from '../room-crowding.ts'
import { projectRoomHandovers, roomAnchorPair } from '../room-anchors.ts'
import { removableOnce } from '../scene-lifecycle.ts'
import { hiddenRoomSpeech } from '../room-speech.ts'
import { positionSpeechLayer } from './BubbleView.ts'
import { RoomCanvas } from './RoomCanvas.ts'
import { RoomMotion } from './RoomMotion.ts'
import { startupMoveSuppressions } from '../startup-moves.ts'
import { pauseAdvance } from '../speech-pause.ts'

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
  private liveDeliveryCounts: Readonly<Record<string, number>> = {}
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
  private outlineResolutions: Readonly<Record<number, OutlineResolution>> = {}
  private outlineActive = 0
  private outlineDrawingReads = 0
  private outlinePending = new Map<number, PlaceOutline>()
  private outlineGeneration = 0
  private recordThingIds: ReadonlySet<number> = new Set()
  private clock?: Clock
  private rooms?: RoomView
  private displayLayout?: NestedLayout
  private roomCrowding?: RoomCrowdingState
  private readonly roomMotion = new RoomMotion()
  private startupMoves: ReadonlySet<string> = new Set()
  private canvas?: RoomCanvas
  private get viewport(): Readonly<{ width: number; height: number }> {
    return this.canvas?.frame ?? { width: 0, height: 0 }
  }
  private layoutRevision = 0
  private roomResidents: Simulation['residents'] = {}
  private roomThings: ThingSimulation['things'] = {}
  private playbackSpeed = 1
  private readonly readResidentDrawing = createDrawingLoader()
  private readonly readPlaceDrawing = createDrawingLoader(undefined, 'place')
  private placeDrawingReads = 0
  private activityLog?: RoomActivityLine
  private removeActivityShutdown = (): void => {}
  private activity?: SceneActivity
  private activityBase?: ActivityContext
  private historicalActivity?: ActivityContext
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
  private lastFollowChoices = ''
  private cursor = 0
  private elapsed = 0
  private paused = false
  private pauseDeadline: number | null = null
  private following: number | null = null
  private viewPlaceId: number | null = null
  private readIssues: string[] = []
  private lastFigures = ''
  private readonly fixtureMode = fixtureMode()
  constructor() { super('city') }
  create(): void {
    document.body.dataset['liveReady'] = 'loading'
    document.body.dataset['liveFollowing'] = ''
    document.body.dataset['liveMode'] = 'live'
    this.connectControls()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.sounds.destroy())
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.pollGeneration += 1; window.clearTimeout(this.pollTimer) })
    this.canvas = new RoomCanvas(this, () => this.showRoom(this.viewPlaceId))
    void this.loadCity()
  }
  private async loadCity(): Promise<void> {
    const firstLoad = this.replay === undefined
    try {
      const [record, censusRead] = await Promise.allSettled([fetchReplay(), fetchCensus()])
      if (record.status === 'rejected') throw record.reason
      if (censusRead.status === 'rejected') throw censusRead.reason
      if (!firstLoad) {
        this.pollGeneration += 1; window.clearTimeout(this.pollTimer); this.polling = false
        this.rooms?.destroy(); this.activity?.destroy(); this.activityLog?.destroy()
        this.agreementLayer.clear(); this.inventionLayer?.clear(); this.sounds.reset()
        for (const view of this.figures.values()) view.destroy()
        for (const view of this.thingViews.values()) view.destroy()
        this.handoverLayer.clear()
        this.figures.clear(); this.thingViews.clear()
        this.elapsed = 0; this.cursor = 0; this.liveHistory = []; this.liveQueue = []; this.liveCatchup = []
        this.liveCaughtUp = false; this.handoverFrame = undefined
        this.inventions = Object.freeze({ moments: [], pending: false, issues: [] })
        this.outlineReads.clear(); this.outlineResolutions = {}; this.outlinePending.clear(); this.outlineGeneration += 1
      }
      const census = censusRead.value
      this.census = census
      this.replay = record.value
      this.layout = nestedLayout(this.replay.map.places, roomCapacity(this.replay, census))
      this.replay = Object.freeze({ ...this.replay, timeline: await readInitialNoteWords(this.replay.timeline,
        this.layout, this.readNote, message => this.thingReadIssue(message)) })
      this.timeline = prepareTimeline(this.replay.timeline)
      await this.loadAgreementPairs(this.replay.timeline)
      const speed = motionSpeed(this.playbackSpeed)
      this.clock = { ...createClock(this.replay.window_start, this.replay.window_end, this.playbackSpeed), time: Date.now() }
      await this.loadPlaceNames()
      this.sleepers = sleepingResidents(census)
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
      this.liveDeliveryCounts = {}
      this.placeAnimations = []
      this.liveState = Object.freeze({ marker: this.replay.checkpoint, seen: new Set<string>(), failures: 0, lastReadAt: null, retryMs: 0 })
      this.inventionLayer = new InventionLayer(this)
      this.updateRooms()
      addDrawingTexture(this, 'resident-default', null)
      addThingTexture(this, 'thing-default', null)
      this.history.reset(this.presentationState())
      if (firstLoad) this.viewPlaceId = busiestRoom(this.replay.map.places, census, this.replay.timeline)
      this.showRoom(this.viewPlaceId)
      this.prepareRoomPresentation()
      this.drawThings()
      this.drawResidents()
      this.updateHud()
      await this.loadDrawings(census)
      document.body.dataset['liveReady'] = 'true'
      this.updateHud()
      void this.loadPlaceDrawings()
      void this.loadThingDetails()
      void this.pollLive()
    } catch (error) {
      // Keep the last picture and retry; a failed read never invents a new state.
      console.error(error)
      this.readIssues.push('The public record could not be read.')
      document.body.dataset['liveReady'] = 'error'
      this.updateHud()
      this.pollTimer = window.setTimeout(() => void this.loadCity(), 30_000)
    }
  }
  private connectActivityLog(): void {
    if (!this.replay || !this.placePlan || !this.layout) return
    this.removeActivityShutdown()
    const context = createActivityContext(this.census, this.replay.map.places, (place, time) =>
      hiddenRooms(this.placePlan!, this.layout!, time).has(place.id) ? null : recordedRoomName(this.placePlan!, place, time))
    const residents = context.resident
    const dynamic: ActivityContext = { ...context, resident: (actor: string) => {
      const known = residents(actor)
      if (known) return known
      const id = this.residents?.actors.get(actor)
      return id === undefined ? null : { type: 'resident' as const, id, name: actor, hasDrawing: false }
    }, actorRoom: (actor: string, time: number) => this.historicalActivity?.actorRoom?.(actor, time) ?? null,
    thing: (id: number, time: number) => this.historicalActivity?.thing?.(id, time) ?? null,
    effect: (id: number, time: number) => this.historicalActivity?.effect?.(id, time) ?? null,
    placementVisibility: (subject, time, before) => this.historicalActivity?.placementVisibility?.(subject, time, before) ?? 'unknown' }
    this.activityBase = context
    this.historicalActivity = createHistoricalActivityContext(this.replay, this.census, context)
    this.activityLog = new RoomActivityLine(document.getElementById('room-activity')!, dynamic)
    this.activity = new SceneActivity(this, this.activityLog, dynamic)
    const log = this.activityLog; const activity = this.activity
    this.removeActivityShutdown = removableOnce(this.events, Phaser.Scenes.Events.SHUTDOWN, () => {
      activity.destroy(); log.destroy()
    })
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
    const id = this.viewPlaceId
    if (id === null || !this.layout || !roomIsPublic(this.layout, id)
      || !this.replay?.map.places.some(place => place.id === id && place.has_drawing)) return
    this.placeDrawingReads += 1
    try {
      const art = await this.readPlaceDrawing(id)
      if (art && this.viewPlaceId === id) this.rooms?.addDrawing(this, id, art)
    } catch (error) { console.error(error); this.thingReadIssue('This room drawing could not be read.') }
    finally { this.placeDrawingReads -= 1 }
  }
  update(_time: number, delta: number): void {
    if (!this.clock || !this.residents || !this.layout || !this.replay) return
    this.configureRoomMotion()
    const pauseFrame = pauseAdvance(animationDelta(delta, { ready: document.body.dataset['liveReady'] === 'true', paused: this.paused,
      jumping: this.jumpingLive, readFailed: this.liveReadError, presenceLost: this.presenceLost }), this.elapsed, this.pauseDeadline)
    const elapsed = pauseFrame.delta
    if (elapsed > 0) {
      if (this.backward) {
        const frame = this.history.rewind(elapsed)
        if (frame) this.restorePresentation(frame)
        if (!this.history.canRewind) this.paused = true
      } else {
      this.elapsed += elapsed
      if (this.mode === 'live') {
        this.placeAnimations = stepPlaceAnimations(this.placeAnimations, [], this.elapsed)
        if (this.pauseDeadline === null && !blocksLiveDelivery(this.residents) && !this.things?.pending
          && (!this.handoverFrame || !blocksLiveHandoverDelivery(this.handoverFrame)) && this.liveQueue.length) {
          const firstAt = Date.parse(this.liveQueue[0]!.at)
          const incoming = this.liveQueue.filter(row => Date.parse(row.at) === firstAt)
          this.liveQueue = this.liveQueue.slice(incoming.length)
          this.clock = { ...this.clock, time: firstAt }
          this.liveDeliveredMarker = Math.max(this.liveDeliveredMarker, ...incoming.map(row => Number(row.change_id)))
          if (this.fixtureMode) this.liveDeliveryCounts = Object.freeze({ ...this.liveDeliveryCounts,
            ...Object.fromEntries(incoming.map(row => [row.change_id, (this.liveDeliveryCounts[row.change_id] ?? 0) + 1])) })
          this.prepareLiveEvents(incoming)
          this.applyEvents(incoming, elapsed)
        } else { this.applyEvents([], elapsed); if (!blocksLiveDelivery(this.residents) && !this.liveQueue.length) {
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
      this.roomMotion.idle(this.residents.residents, elapsed, this.elapsed, this.sleepers)
      this.history.record(this.presentationState())
      }
    }
    if (pauseFrame.paused) { this.paused = true; this.pauseDeadline = null }
    this.updateFollowCamera()
    this.updateRooms()
    if (!this.paused && !this.backward && !this.history.rewound) void this.readLooking()
    if (!this.backward && !this.history.rewound) this.updateOutlines()
    this.prepareRoomPresentation()
    this.drawThings()
    this.drawResidents()
    this.sounds.update(this.elapsed, this.paused || this.backward || this.history.rewound, this.residents, this.figures, this.placeAnimations, this.layout, this.cameras.main)
    this.drawHandovers()
    this.activity?.update(this.roomResidents,
      this.roomThings, this.displayLayout ?? this.layout, this.displayHiddenRooms(), this.elapsed, 1,
      this.mode === 'live' && !this.paused && !this.backward && !this.history.rewound ? Date.now() : undefined,
      roomAnchorPair(this.layout, this.displayLayout, this.viewPlaceId))
    this.inventionLayer?.update(this.inventions, { ...this.residents, residents: this.roomResidents }, this.displayHiddenRooms(), 1)
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
        if (!this.liveCaughtUp) this.startupMoves = startupMoveSuppressions(completed, this.census)
        this.liveHistory = Object.freeze([...this.liveHistory, ...completed])
        if (this.mode === 'live') this.liveQueue = Object.freeze([...this.liveQueue,
          ...eventsAfterMarker(completed, this.liveDeliveredMarker)])
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
      if (this.sleepers.has(resident.id)) continue
      const points = [resident.placeId !== null && resident.visible ? { placeId: resident.placeId, key: `resident:${resident.id}`, x: resident.x, y: resident.y } : null,
        resident.destinationId !== null && resident.destination ? { placeId: resident.destinationId, key: `destination:${resident.id}`, ...resident.destination } : null]
      for (const point of points) if (point) (blockers[point.placeId] ??= []).push(residentReservationFootprint(point.key, point))
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
  }
  replayDay(): void {
    if (!this.replay || !this.layout) return
    this.mode = 'replay'
    this.reviewingLive = false
    this.paused = false
    this.backward = false
    this.clock = createClock(this.replay.window_start, this.replay.window_end,
      this.playbackSpeed)
    this.activity?.reset([], this.clock.start)
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
    this.outlineResolutions = {}
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
    this.residents = stepResidents(this.residents, events, elapsed, this.elapsed, this.layout, this.clock.speed, this.agreementPairs, row => this.isResidentDrawn(row), {
      startMove: (resident, event, all) => this.roomMotion.start(resident, event, all),
      advanceMove: (resident, delta) => this.roomMotion.advance(resident, delta), allowStarts: this.pauseDeadline === null,
    })
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
    if (this.paused) { this.presenceReadAt = Date.now(); return }
    const changes = sleepTransitions(this.census, census)
    this.activityLog?.appendEntries(sleepActivityEntries(changes, this.layout, Date.now()))
    this.census = census
    this.sleepers = sleepingResidents(census)
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
    const state = this.roomThings
    const zoom = 1 // Room decorations retain their size in CSS pixels.
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
      view.update(thing, thing.name ?? this.thingNames.get(thing.id) ?? null, zoom, this.elapsed, this.handoverFrame?.carryThingIds.includes(thing.id) ?? false)
    }
    document.body.dataset['liveThingsCount'] = String([...this.thingViews.values()].filter(view => view.sprite.visible).length)
    if (document.body.dataset['liveReady'] === 'true') void this.loadThingDetails()
    if (this.fixtureMode) {
      document.body.dataset['liveThings'] = JSON.stringify(Object.values(state).filter(thing => thing.visible && thing.placeId === this.viewPlaceId && !this.contentsHidden.has(thing.placeId)).map(thing => ({
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
    const candidates = this.viewPlaceId === null ? [] : [this.layout.rooms[this.viewPlaceId]]
      .filter((room): room is NonNullable<typeof room> => Boolean(room) && !this.contentsHidden.has(room!.id)
        && roomIsPublic(this.layout!, room!.id) && !this.outlineReads.has(room!.id)).slice(0, slots)
    for (const room of candidates) {
      const generation = this.outlineGeneration
      this.outlineReads.add(room.id)
      this.outlineActive += 1
      void this.readOutline(room.id).then(outline => {
        if (generation !== this.outlineGeneration) return
        if (!outline) {
          this.outlineResolutions = { ...this.outlineResolutions, [room.id]: 'unmergeable' }
          if (!this.fixtureMode) this.thingReadIssue('A nearby room outline was missing; its floor is kept.')
          return
        }
        if (this.contentsHidden.has(room.id)) {
          this.outlineResolutions = { ...this.outlineResolutions, [room.id]: 'unmergeable' }; return
        }
        if (this.roomHasMotion(room.id)) this.outlinePending.set(room.id, outline)
        else this.mergeOutline(outline)
      }).catch(error => {
        if (generation !== this.outlineGeneration) return
        this.outlineResolutions = { ...this.outlineResolutions, [room.id]: 'unmergeable' }
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
    if (this.backward || this.history.rewound || this.mode !== 'live' || !this.layout || !this.residents || !this.things || this.contentsHidden.has(outline.placeId)) {
      this.outlineResolutions = { ...this.outlineResolutions, [outline.placeId]: 'unmergeable' }; return
    }
    const blockers: StageStandingSpot[] = Object.values(this.residents.residents).flatMap(resident => {
      if (this.sleepers.has(resident.id)) return []
      const points = [resident.placeId === outline.placeId && resident.visible ? { key: `resident:${resident.id}`, x: resident.x, y: resident.y } : null,
        resident.destinationId === outline.placeId && resident.destination ? { key: `destination:${resident.id}`, ...resident.destination } : null]
      return points.flatMap(point => point ? [residentReservationFootprint(point.key, point)] : [])
    })
    const before = this.things
    this.things = addPresentThings(before, outline, this.layout, this.recordThingIds, blockers)
    this.outlineResolutions = { ...this.outlineResolutions, [outline.placeId]: 'merged' }
    this.residents = Object.freeze({ ...this.residents, reservations: this.things.reservations })
    for (const row of outline.things) {
      if (this.recordThingIds.has(row.id) || before.things[row.id] || !this.things.things[row.id]) continue
      this.thingReads.add(row.id)
      this.thingNames.set(row.id, row.name)
      if (row.hasDrawing) void this.loadOutlineThingDrawing(row.id)
    }
  }
  private async loadOutlineThingDrawing(id: number): Promise<void> {
    this.outlineDrawingReads += 1
    try {
      const art = await this.readThingDrawing(id)
      if (!art) return
      addThingTexture(this, `thing-${id}`, art)
      this.thingViews.get(id)?.sprite.setTexture(`thing-${id}`)
    } catch (error) {
      console.error(error)
      this.thingReadIssue('Some thing drawings could not be read; their pixel icons are kept.')
    } finally { this.outlineDrawingReads -= 1 }
  }
  private drawHandovers(): void {
    const frame = this.handoverFrame && this.handovers
      ? projectRoomHandovers(this.handoverFrame, this.handovers, this.roomResidents, this.elapsed) : undefined
    this.handoverLayer.update(frame, this.handovers, this.residents, this.displayHiddenRooms())
    if (this.fixtureMode && this.handoverFrame?.motions.length) document.body.dataset['liveHandoverShown'] = 'true'
  }
  private async loadThingDetails(): Promise<void> {
    const things = this.things?.things ?? {}; const hidden = this.displayHiddenRooms()
    if (this.readingThings || !Object.values(things).some(thing => thing.visible && !hidden.has(thing.placeId) && !this.thingReads.has(thing.id))) return
    this.readingThings = true
    try { await readVisibleThingDetails(this.things?.things ?? {}, this.displayHiddenRooms(), this.thingReads, this.readThing, this.readThingDrawing,
      (id, name) => this.thingNames.set(id, name), (id, art) => { addThingTexture(this, `thing-${id}`, art); this.thingViews.get(id)?.sprite.setTexture(`thing-${id}`) },
      message => this.thingReadIssue(message)) } finally { this.readingThings = false }
  }
  private thingReadIssue(message: string): void {
    if (!this.readIssues.includes(message)) this.readIssues.push(message)
  }
  private prepareRoomPresentation(): void {
    this.configureRoomMotion()
    const frame = presentRoom(this.residents?.residents ?? {}, this.things?.things ?? {}, this.layout,
      this.displayLayout, this.displayHiddenRooms(), this.roomCrowding, this.following, this.agreementLayer.project(this.elapsed),
      this.roomMotion.presentation(this.viewPlaceId), this.sleepers)
    this.roomCrowding = frame.crowding
    this.roomResidents = frame.residents
    this.roomThings = frame.things
    this.roomMotion.remember(frame.residents, frame.things)
  }
  private configureRoomMotion(): void {
    if (this.layout) this.roomMotion.configure(this.layout, this.things?.things ?? {}, this.viewport,
      this.viewPlaceId, this.following, this.contentsHidden, this.startupMoves, this.sleepers)
  }
  private drawResidents(): void {
    const state = this.roomResidents
    const usable = roomViewportUsable(this.viewport.width, this.viewport.height)
    let visibleSpeech: { residentId: number; text: string; shape: string; showing: string } | null = null
    for (const [id, figure] of this.figures) if (!state[id] || this.sleepers.has(id)) {
      figure.destroy()
      this.figures.delete(id)
    }
    for (const resident of Object.values(state)) {
      if (this.sleepers.has(resident.id)) continue
      let figure = this.figures.get(resident.id)
      if (!figure) {
        figure = new ResidentView(this, resident)
        figure.sprite.disableInteractive()
        if (this.textures.exists(`resident-${resident.id}`)) figure.sprite.setTexture(`resident-${resident.id}`)
        this.figures.set(resident.id, figure)
      }
      const hidden = !usable || !this.isResidentDrawn(resident) || resident.placeId !== this.viewPlaceId
      const speech = figure.update(hidden ? { ...resident, visible: false } : resident, this.elapsed,
        this.replay?.map.places, this.viewport)
      if (speech && (visibleSpeech === null || speech.residentId === this.following)) visibleSpeech = speech
    }
    positionSpeechLayer()
    const obstacles = [...this.figures].flatMap(([id, figure]) => figure.sprite.visible
      ? [{ ...figure.sprite.getBounds(), id: String(id) }] : [])
      .concat([...this.thingViews].flatMap(([id, thing]) => thing.sprite.visible
        ? [{ ...thing.sprite.getBounds(), id: `thing:${id}` }] : []))
    const labels = visibleRoomLabels([...this.figures].flatMap(([id, figure]) => {
      const box = figure.labelBounds()
      return box && roomLabelFitsViewport(box, this.viewport.width, this.viewport.height)
        ? [{ ...box, id: String(id), priority: roomFigurePriority(state[id]!, this.following) }] : []
    }).concat([...this.thingViews].flatMap(([id, thing]) => {
      const box = thing.labelBounds()
      return box && roomLabelFitsViewport(box, this.viewport.width, this.viewport.height)
        ? [{ ...box, id: `thing:${id}`, priority: 0 }] : []
    })), obstacles)
    for (const [id, thing] of this.thingViews) thing.setNameVisible(labels.has(`thing:${id}`))
    for (const [id, figure] of this.figures) figure.setNameVisible(labels.has(String(id)))
    this.activityLog?.setUnshownSpeech(hiddenRoomSpeech(this.residents?.residents ?? {}, this.roomResidents,
      this.layout, this.viewPlaceId, this.contentsHidden, this.elapsed, this.sleepers))
    this.agreementLayer.draw(this, this.figures, this.displayHiddenRooms())
    recordSpeechFixture(visibleSpeech, this.fixtureMode, this.agreementLayer.count)
    this.updateFollowChoices()
    if (!this.fixtureMode) return
    const listed = JSON.stringify([...this.figures].flatMap(([id, figure]) => figure.sprite.visible
      && figure.sprite.x >= 0 && figure.sprite.x <= this.viewport.width && figure.sprite.y >= 0 && figure.sprite.y <= this.viewport.height
      ? [{ id, x: figure.sprite.x, y: figure.sprite.y }] : []))
    if (listed === this.lastFigures) return
    this.lastFigures = listed
    document.body.dataset['liveFigures'] = listed
    document.body.dataset['liveFigureSizes'] = JSON.stringify([...this.figures].flatMap(([id, figure]) => figure.sprite.visible
      ? [{ id, width: figure.sprite.displayWidth * this.cameras.main.zoom / (this.canvas?.frame.zoom ?? 1),
        height: figure.sprite.displayHeight * this.cameras.main.zoom / (this.canvas?.frame.zoom ?? 1) }] : []))
  }
  private connectControls(): void {
    const resident = document.querySelector<HTMLSelectElement>('#follow-picker')!
    const place = document.querySelector<HTMLSelectElement>('#place-picker')!
    const pause = document.querySelector<HTMLButtonElement>('#pause')!
    const follow = (): void => {
      const id = Number(resident.value)
      if (!resident.value || !Number.isSafeInteger(id) || !this.residents?.residents[id]) return
      this.following = id
      this.updateFollowCamera()
      this.updateHud()
    }
    const stay = (): void => {
      const id = Number(place.value)
      if (!place.value || !Number.isSafeInteger(id) || !this.layout?.rooms[id]) return
      this.following = null
      this.showRoom(id)
      this.updateHud()
    }
    const toggle = (): void => {
      if (this.paused || this.pauseDeadline !== null) { this.paused = false; this.pauseDeadline = null }
      else {
        const deadline = Math.max(this.elapsed, ...[...this.figures.values()].map(figure => figure.speechPauseAt(this.elapsed)))
        if (deadline <= this.elapsed) this.paused = true
        else this.pauseDeadline = deadline
      }
      this.updateHud()
    }
    resident.addEventListener('change', follow); place.addEventListener('change', stay); pause.addEventListener('click', toggle)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      resident.removeEventListener('change', follow); place.removeEventListener('change', stay); pause.removeEventListener('click', toggle)
    })
  }
  private showRoom(id: number | null): void {
    if (id === null || !this.layout?.rooms[id] || !this.placePlan) return
    this.viewPlaceId = id
    this.activityLog?.selectRoom(id)
    if (!roomViewportUsable(this.viewport.width, this.viewport.height)) { this.updateHud(); return }
    const source = this.layout.rooms[id]!
    this.displayLayout = singleRoomLayout({ ...source, quiet: !roomIsPublic(this.layout, id) }, this.viewport.width, this.viewport.height)
    this.roomCrowding = undefined
    this.rooms?.destroy()
    this.rooms = new RoomView(this, this.displayLayout, this.placePlan, false)
    this.layoutRevision += 1
    this.updateRooms()
    void this.loadPlaceDrawings()
    this.updateHud()
  }
  private isResidentDrawn(resident: Simulation['residents'][number]): boolean {
    return resident.visible && !this.sleepers.has(resident.id) && resident.placeId !== null && !this.contentsHidden.has(resident.placeId)
      && Boolean(this.layout && roomIsPublic(this.layout, resident.placeId))
  }
  private updateFollowCamera(): void {
    const resident = this.following === null ? undefined : this.residents?.residents[this.following]
    if (resident?.placeId != null && resident.placeId !== this.viewPlaceId) this.showRoom(resident.placeId)
  }
  private updateFollowChoices(): void {
    const residents = Object.values(this.residents?.residents ?? {})
      .filter(row => row.placeId !== null && this.layout?.rooms[row.placeId] && !row.handle.startsWith('resident:'))
      .sort((a, b) => a.handle.localeCompare(b.handle) || a.id - b.id)
    const choices = JSON.stringify(residents.map(row => [row.id, row.handle]))
    if (choices === this.lastFollowChoices) return
    this.lastFollowChoices = choices
    const picker = document.querySelector<HTMLSelectElement>('#follow-picker')!
    const prompt = new Option('Follow a resident…', ''); prompt.disabled = true
    picker.replaceChildren(prompt, ...residents.map(row => new Option(row.handle, String(row.id))))
  }
  private displayHiddenRooms(): ReadonlySet<number> {
    return new Set(Object.keys(this.layout?.rooms ?? {}).map(Number)
      .filter(id => id !== this.viewPlaceId || !this.displayLayout?.rooms[id] || this.contentsHidden.has(id) || !roomIsPublic(this.layout!, id)))
  }
  private presentationState(): PresentationState {
    return { clock: this.clock!, residents: this.residents!, things: this.things!, handovers: this.handovers!,
      handoverFrame: this.handoverFrame, inventions: this.inventions, placeAnimations: this.placeAnimations,
      elapsed: this.elapsed, cursor: this.cursor, mode: this.mode, liveDeliveredMarker: this.liveDeliveredMarker,
      sleepers: this.sleepers, agreements: this.agreementLayer.snapshot(), activity: this.activity?.snapshot() }
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
  private updateHud(): void {
    const ready = document.body.dataset['liveReady'] === 'true'
    const failed = this.liveReadError || this.presenceLost || document.body.dataset['liveReady'] === 'error'
    document.body.dataset['liveMode'] = this.mode
    document.body.dataset['livePaused'] = String(this.paused)
    document.body.dataset['liveFollowing'] = this.following === null ? '' : String(this.following)
    document.body.dataset['liveRoom'] = this.viewPlaceId === null ? '' : String(this.viewPlaceId)
    document.body.dataset['liveReadError'] = String(failed)
    if (this.fixtureMode) {
      document.body.dataset['liveDeliveredMarker'] = String(this.liveDeliveredMarker)
      document.body.dataset['liveElapsed'] = String(this.elapsed)
      document.body.dataset['liveDeliveryCounts'] = JSON.stringify(this.liveDeliveryCounts)
      document.body.dataset['liveMotion'] = JSON.stringify(this.roomMotion.diagnostics())
    }
    const pause = document.querySelector<HTMLButtonElement>('#pause')!
    const holding = this.paused || this.pauseDeadline !== null
    pause.disabled = !ready; pause.textContent = holding ? 'Resume' : 'Pause'
    pause.setAttribute('aria-label', holding ? 'Resume' : 'Pause')
    pause.setAttribute('aria-pressed', String(holding))
    const room = this.viewPlaceId === null ? undefined : this.layout?.rooms[this.viewPlaceId]
    document.body.dataset['liveLayoutRevision'] = String(this.layoutRevision)
    const { needsOutline, quiet } = roomPictureAccess(this.layout, this.viewPlaceId, this.contentsHidden)
    document.body.dataset['livePictureSettled'] = String(roomPictureSettled({
      ready: ready && Boolean(roomAnchorPair(this.layout, this.displayLayout, this.viewPlaceId) || quiet)
        && roomViewportUsable(this.viewport.width, this.viewport.height),
      firstPollMerged: this.liveCaughtUp, needsOutline,
      outline: room ? this.outlineResolutions[room.id] ?? 'pending' : 'pending',
      pendingReads: this.outlineActive + this.outlineDrawingReads + this.placeDrawingReads + Number(this.readingThings),
      pendingOutline: room ? this.outlinePending.has(room.id) : false,
    }))
    const name = room && this.placePlan ? recordedRoomName(this.placePlan, room, this.clock?.time ?? Date.now()) : null
    document.getElementById('room-name')!.textContent = name ?? (failed ? 'City unavailable' : 'Opening the city…')
    document.getElementById('live-status')!.textContent = roomStatus({
      tooSmall: !roomViewportUsable(this.viewport.width, this.viewport.height), readFailed: failed,
      quiet,
    })
    const picker = document.querySelector<HTMLSelectElement>('#place-picker')!
    const places = (this.replay?.map.places ?? []).map(place => ({ ...place,
      name: this.placePlan ? recordedRoomName(this.placePlan, this.layout!.rooms[place.id]!, this.clock?.time ?? Date.now()) ?? '' : place.name }))
    const signature = JSON.stringify(places.map(place => [place.id, place.name]))
    if (picker.dataset['choices'] !== signature) {
      picker.dataset['choices'] = signature
      const prompt = new Option('Stay in a place…', ''); prompt.disabled = true
      picker.replaceChildren(prompt, ...[...places].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
        .map(place => new Option(place.name, String(place.id))))
    }
    picker.value = this.following === null && this.viewPlaceId !== null ? String(this.viewPlaceId) : ''
    picker.disabled = !ready
    const resident = document.querySelector<HTMLSelectElement>('#follow-picker')!
    resident.value = this.following === null ? '' : String(this.following); resident.disabled = !ready
  }
}
