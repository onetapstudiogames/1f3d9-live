import Phaser from 'phaser'
import { fetchReplay, fetchCensus, createDrawingLoader, createThingLoader, createNameHistoryLoader, createPlaceOutlineLoader } from '../city/api.ts'
import type { PlaceOutline, ReplayFile, Resident } from '../city/types.ts'
import { nestedLayout, type NestedLayout } from '../ground/nested.ts'
import { createClock, dueEvents, prepareTimeline, type Clock, type TimelineRow } from '../replay/index.ts'
import { createResidents, prepareLiveResidents, stepResidents, stepIdleResidents, roomCapacity, type Simulation } from '../replay/simulation.ts'
import { RoomView } from './RoomView.ts'
import { ResidentView, addDrawingTexture } from './ResidentView.ts'
import { sleepingResidents } from '../sleep.ts'
import { addPresentThings, createThings, recordThingIds, stepThings, type ThingSimulation } from '../things.ts'
import type { StageStandingSpot } from '../ground/stage-ground.ts'
import { ThingView, addThingTexture } from './ThingView.ts'
import { createHandovers, stepHandovers, type HandoverState } from '../handovers.ts'
import { HandoverLayer } from './HandoverView.ts'
import { hiddenRooms, planPlaces, recordedRoomName, type PlacePlan } from '../places.ts'
import { contentHiddenRooms, placeAnimation, stepPlaceAnimations, type PlaceAnimation } from '../place-animation.ts'
import { createNoteExcerptLoader, fetchChanges } from '../city/changes.ts'
import { liveReadFailed, liveReadSucceeded, newLiveEvents, settleAtNow, validContinuation, wakeActiveSleepers, type LiveReadState } from '../live.ts'
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
import { SceneHistory, type PresentationState } from './SceneHistory.ts'
import { SceneActivity } from './SceneActivity.ts'
import { readNoteWords, readPlacePlan, readResidentDrawings, readVisibleThingDetails } from './SceneDetails.ts'

import { busiestRoom, singleRoomLayout, projectRoomPoint, roomIsPublic } from '../room-view.ts'
import { RoomActivityLine } from './RoomActivityLine.ts'

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
  private displayLayout?: NestedLayout
  private playbackSpeed = 1
  private readonly readResidentDrawing = createDrawingLoader()
  private readonly readPlaceDrawing = createDrawingLoader(undefined, 'place')
  private activityLog?: RoomActivityLine
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
  private showSleepers = true
  private lastFollowChoices = ''
  private cursor = 0
  private elapsed = 0
  private paused = false
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
    document.body.dataset['liveShowSleepers'] = String(this.showSleepers)
    const sleeperControl = document.querySelector<HTMLInputElement>('#show-sleepers')
    if (sleeperControl) sleeperControl.checked = this.showSleepers
    this.connectControls()
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.sounds.destroy())
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.pollGeneration += 1; window.clearTimeout(this.pollTimer) })
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.showRoom(this.viewPlaceId))
    void this.loadCity()
  }
  private async loadCity(reads?: readonly [PromiseSettledResult<ReplayFile>, PromiseSettledResult<readonly Resident[]>]): Promise<void> {
    const requestedAt = Date.now()
    const firstLoad = this.replay === undefined
    try {
      const [record, censusRead] = reads ?? await Promise.allSettled([fetchReplay(), fetchCensus()])
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
        this.outlineReads.clear(); this.outlinePending.clear(); this.outlineGeneration += 1
      }
      const census = censusRead.value
      this.census = census
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
      this.activity?.reset([], this.clock.end)
      this.observeLooking(census)
      this.liveDeliveredMarker = Number(this.replay.checkpoint)
      // Keep every change witnessed after the reads began, including slow startup reads.
      this.liveNotBefore = requestedAt
      this.placeAnimations = []
      this.liveState = Object.freeze({ marker: this.replay.checkpoint, seen: new Set<string>(), failures: 0, lastReadAt: null, retryMs: 0 })
      this.inventionLayer = new InventionLayer(this)
      this.updateRooms()
      addDrawingTexture(this, 'resident-default', null)
      addThingTexture(this, 'thing-default', null)
      this.drawThings()
      this.drawResidents()
      this.history.reset(this.presentationState())
      if (firstLoad) this.viewPlaceId = busiestRoom(this.replay.map.places, census)
      this.showRoom(this.viewPlaceId)
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
    const id = this.viewPlaceId
    if (id === null || !this.layout || !roomIsPublic(this.layout, id)
      || !this.replay?.map.places.some(place => place.id === id && place.has_drawing)) return
    try {
      const art = await this.readPlaceDrawing(id)
      if (art && this.viewPlaceId === id) this.rooms?.addDrawing(this, id, art)
    } catch (error) { console.error(error); this.thingReadIssue('This room drawing could not be read.') }
  }
  update(_time: number, delta: number): void {
    if (!this.clock || !this.residents || !this.layout || !this.replay) return
    if (document.body.dataset['liveReady'] === 'true' && !this.paused && !this.jumpingLive && !this.liveReadError && !this.presenceLost) {
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
    this.updateFollowCamera()
    this.updateRooms()
    if (!this.backward && !this.history.rewound) void this.readLooking()
    this.lookingAwake = this.activity?.activeLookingIds(Date.now()) ?? new Set()
    if (!this.backward && !this.history.rewound) this.updateOutlines()
    this.drawThings()
    this.drawResidents()
    this.sounds.update(this.elapsed, this.paused || this.backward || this.history.rewound, this.residents, this.figures, this.placeAnimations, this.layout, this.cameras.main)
    this.drawHandovers()
    this.activity?.update(Object.fromEntries(Object.values(this.residents.residents).filter(row => this.isResidentDrawn(row)).map(row => [row.id, row])),
      this.things?.things ?? {}, this.layout, this.displayHiddenRooms(), this.elapsed, this.cameras.main.zoom,
      this.mode === 'live' && !this.backward && !this.history.rewound ? Date.now() : undefined)
    this.inventionLayer?.update(this.inventions, this.residents, this.displayHiddenRooms(), this.cameras.main.zoom)
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
          ...completed.filter(row => Date.parse(row.at) >= this.liveNotBefore)])
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
  replayDay(): void {
    if (!this.replay || !this.layout) return
    this.mode = 'replay'
    this.reviewingLive = false
    this.paused = false
    this.backward = false
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
      const source = this.layout?.rooms[thing.placeId]
      const target = this.displayLayout?.rooms[thing.placeId]
      const point = source && target ? projectRoomPoint(thing, source, target) : null
      const drawn = point && !this.contentsHidden.has(thing.placeId) && source && roomIsPublic(this.layout!, source.id)
        ? { ...thing, ...point } : { ...thing, visible: false }
      view.update(drawn, null, zoom, this.elapsed, this.handoverFrame?.carryThingIds.includes(thing.id) ?? false)
    }
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
    this.handoverLayer.update(this.handoverFrame, this.handovers, this.residents, this.displayHiddenRooms())
    if (this.fixtureMode && this.handoverFrame?.motions.length) document.body.dataset['liveHandoverShown'] = 'true'
  }
  private async loadThingDetails(): Promise<void> {
    if (this.readingThings) return
    this.readingThings = true
    try { await readVisibleThingDetails(this.things?.things ?? {}, this.displayHiddenRooms(), this.thingReads, this.readThing, this.readThingDrawing,
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
        figure.sprite.disableInteractive()
        if (this.textures.exists(`resident-${resident.id}`)) figure.sprite.setTexture(`resident-${resident.id}`)
        this.figures.set(resident.id, figure)
      }
      const hidden = !this.isResidentDrawn(resident) || resident.placeId !== this.viewPlaceId
      const sleeping = this.sleepers.has(resident.id) && !this.lookingAwake.has(resident.id)
      const sleeperHidden = sleeping && !this.showSleepers
      const source = resident.placeId === null ? undefined : this.layout?.rooms[resident.placeId]
      const target = resident.placeId === null ? undefined : this.displayLayout?.rooms[resident.placeId]
      const point = source && target ? projectRoomPoint(projected.get(resident.id) ?? resident, source, target) : null
      const displayed = point ? { ...resident, ...point } : { ...resident, visible: false }
      const speech = figure.update(hidden || sleeperHidden ? { ...displayed, visible: false } : displayed, camera.zoom, this.elapsed,
        resident.id === this.following, sleeping, this.clock?.time ?? Number.NaN, this.replay?.map.places)
      if (speech && (visibleSpeech === null || speech.residentId === this.following)) visibleSpeech = speech
    }
    this.agreementLayer.draw(this, this.figures, this.displayHiddenRooms())
    recordSpeechFixture(visibleSpeech, this.fixtureMode, this.agreementLayer.count)
    this.updateFollowChoices()
    if (!this.fixtureMode) return
    const listed = JSON.stringify([...this.figures].flatMap(([id, figure]) => figure.sprite.visible
      && figure.sprite.x >= 0 && figure.sprite.x <= this.scale.width && figure.sprite.y >= 0 && figure.sprite.y <= this.scale.height
      ? [{ id, x: figure.sprite.x, y: figure.sprite.y }] : []))
    if (listed === this.lastFigures) return
    this.lastFigures = listed
    document.body.dataset['liveFigures'] = listed
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
    const toggle = (): void => { this.paused = !this.paused; this.updateHud() }
    resident.addEventListener('change', follow); place.addEventListener('change', stay); pause.addEventListener('click', toggle)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      resident.removeEventListener('change', follow); place.removeEventListener('change', stay); pause.removeEventListener('click', toggle)
    })
  }
  private showRoom(id: number | null): void {
    if (id === null || !this.layout?.rooms[id] || !this.placePlan) return
    this.viewPlaceId = id
    const source = this.layout.rooms[id]!
    this.displayLayout = singleRoomLayout({ ...source, quiet: !roomIsPublic(this.layout, id) }, this.scale.width, this.scale.height)
    this.rooms?.destroy()
    this.rooms = new RoomView(this, this.displayLayout, this.placePlan, false)
    this.cameras.main.setZoom(1).setScroll(0, 0)
    this.activityLog?.selectRoom(id)
    this.updateRooms()
    void this.loadPlaceDrawings()
    this.updateHud()
  }
  private isResidentDrawn(resident: Simulation['residents'][number]): boolean {
    return resident.visible && resident.placeId !== null && !this.contentsHidden.has(resident.placeId)
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
      .filter(id => id !== this.viewPlaceId || this.contentsHidden.has(id) || !roomIsPublic(this.layout!, id)))
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
    if (this.fixtureMode) document.body.dataset['liveDeliveredMarker'] = String(this.liveDeliveredMarker)
    document.body.dataset['liveShowSleepers'] = 'true'
    const pause = document.querySelector<HTMLButtonElement>('#pause')!
    pause.disabled = !ready; pause.textContent = this.paused ? 'Resume' : 'Pause'
    pause.setAttribute('aria-label', this.paused ? 'Resume' : 'Pause')
    pause.setAttribute('aria-pressed', String(this.paused))
    const room = this.viewPlaceId === null ? undefined : this.layout?.rooms[this.viewPlaceId]
    const name = room && this.placePlan ? recordedRoomName(this.placePlan, room, this.clock?.time ?? Date.now()) : null
    document.getElementById('room-name')!.textContent = name ?? (failed ? 'City unavailable' : 'Opening the city…')
    document.getElementById('live-status')!.textContent = failed
      ? (room ? 'The city could not be read. Keeping this room and retrying.' : 'The city could not be read. Retrying shortly.') : ''
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
