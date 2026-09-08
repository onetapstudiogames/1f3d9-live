import Phaser from 'phaser'
import { fetchCensus, createDrawingLoader, createThingLoader, createPlaceOutlineLoader } from '../city/api.ts'
import type { PlaceOutline, ReplayEvent, ReplayPlace, Resident } from '../city/types.ts'
import { nestedLayout, type NestedLayout } from '../ground/nested.ts'
import { blocksLiveDelivery, createPresentResidents, dropSleepingResidentBubbles, prepareLiveResidents, stepResidents, type Simulation } from '../replay/simulation.ts'
import { RoomView } from './RoomView.ts'
import { ResidentView, addDrawingTexture } from './ResidentView.ts'
import { sleepingResidents, sleepTransitions } from '../sleep.ts'
import { sleepActivityEntries } from '../sleep-activity.ts'
import { stepThings, type ThingSimulation } from '../things.ts'
import type { StageStandingSpot } from '../ground/stage-ground.ts'
import { ThingView, addThingTexture } from './ThingView.ts'
import { blocksLiveHandoverDelivery, createHandovers, stepHandovers, type HandoverState } from '../handovers.ts'
import { HandoverLayer } from './HandoverView.ts'
import { hiddenRooms, recordedRoomName, type PlacePlan } from '../places.ts'
import { contentHiddenRooms, placeAnimation, stepPlaceAnimations, type PlaceAnimation } from '../place-animation.ts'
import { createNoteExcerptLoader, fetchChanges } from '../city/changes.ts'
import { liveReadFailed, type LiveReadState } from '../live.ts'
import { readCurrentUpdate } from '../current-read.ts'
import { reserveLiveThingEvents, type ThingReservations } from '../things.ts'
import { stepInventions, type InventionState } from '../inventions.ts'
import { InventionLayer } from './InventionLayer.ts'
import { createAgreementPairLoader, type AgreementPair } from '../city/agreements.ts'
import { readAgreementPairs } from '../agreements.ts'
import { AgreementLayer } from './AgreementLayer.ts'
import { fixtureMode, recordSpeechFixture } from './fixture-state.ts'
import { SceneSound } from './SceneSound.ts'
import { motionSpeed } from '../viewer.ts'
import { createActivityContext, type ActivityContext } from '../activity.ts'
import { residentReservationFootprint } from '../resident-footprint.ts'
import { SceneActivity } from './SceneActivity.ts'
import { readNoteWords, readResidentDrawings, readVisibleThingDetails } from './SceneDetails.ts'
import { fetchChangeCursor, fetchCurrentPlaces } from '../city/current.ts'
import { currentPlacePlan, refreshPresentResidents, witnessedEvents } from '../current-state.ts'
import { refreshPresentThings } from '../current-things.ts'
import { placesAfterOutline } from '../current-room.ts'
import { awakeRoomChoices, followRoomState } from '../room-follow.ts'

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
import { pauseAdvance } from '../speech-pause.ts'

export class CityScene extends Phaser.Scene {
  private places: readonly ReplayPlace[] = []
  private census: readonly Resident[] = []
  private liveState?: LiveReadState
  private liveQueue: readonly ReplayEvent[] = []
  private polling = false
  private liveReadError = false
  private liveCaughtUp = false
  private liveDeliveredMarker = 0
  private liveDeliveryCounts: Readonly<Record<string, number>> = {}
  private pollGeneration = 0
  private pollTimer?: number
  private readonly readNote = createNoteExcerptLoader()
  private readonly readAgreement = createAgreementPairLoader()
  private agreementPairs: ReadonlyMap<string, AgreementPair> = new Map()
  private readonly agreementLayer = new AgreementLayer()
  private roomCapacities: Readonly<Record<number, number>> = {}
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
  private clock?: Readonly<{ time: number; speed: number }>
  private rooms?: RoomView
  private displayLayout?: NestedLayout
  private roomCrowding?: RoomCrowdingState
  private readonly roomMotion = new RoomMotion()
  private canvas?: RoomCanvas
  private get viewport(): Readonly<{ width: number; height: number }> {
    return this.canvas?.frame ?? { width: 0, height: 0 }
  }
  private layoutRevision = 0
  private roomResidents: Simulation['residents'] = {}
  private roomThings: ThingSimulation['things'] = {}
  private readonly readResidentDrawing = createDrawingLoader()
  private readonly readPlaceDrawing = createDrawingLoader(undefined, 'place')
  private placeDrawingReads = 0
  private activityLog?: RoomActivityLine
  private removeActivityShutdown = (): void => {}
  private activity?: SceneActivity
  private activityBase?: ActivityContext
  private readonly sounds = new SceneSound(this)
  private placePlan?: PlacePlan
  private placeAnimations: readonly PlaceAnimation[] = []
  private hiddenPlaces: ReadonlySet<number> = new Set()
  private contentsHidden: ReadonlySet<number> = new Set()
  private figures = new Map<number, ResidentView>()
  private sleepers: ReadonlySet<number> = new Set()
  private lastFollowChoices = ''
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
    try {
      const [directory, census] = await Promise.all([fetchCurrentPlaces(), fetchCensus()])
      let places = directory
      const capacity = Object.fromEntries(places.map(place => [place.id,
        census.filter(resident => resident.current_place_id === place.id && !resident.asleep).length]))
      let layout = nestedLayout(places, capacity)
      const selected = this.following === null ? busiestRoom(places, census)
        : census.find(resident => resident.id === this.following)?.current_place_id ?? null
      const outline = selected !== null && roomIsPublic(layout, selected) ? await this.readOutline(selected) : null
      places = placesAfterOutline(places, outline); layout = nestedLayout(places, capacity)
      // The head is a cursor only. None of its older rows reaches the picture or log.
      const marker = await fetchChangeCursor()
      this.places = places; this.census = census; this.layout = layout; this.roomCapacities = capacity
      this.clock = { time: Date.now(), speed: motionSpeed(1) }
      this.liveReadError = false
      this.placePlan = currentPlacePlan(places)
      this.sleepers = sleepingResidents(census)
      this.things = Object.freeze({ things: {}, reservations: {}, issues: [], queue: [], pending: false })
      this.residents = createPresentResidents(census, layout)
      this.handovers = createHandovers([])
      this.connectActivityLog()
      this.activity?.reset()
      this.liveDeliveredMarker = Number(marker)
      this.liveState = Object.freeze({ marker, seen: new Set<string>(), failures: 0, lastReadAt: Date.now(), retryMs: 30_000 })
      this.inventionLayer ??= new InventionLayer(this)
      addDrawingTexture(this, 'resident-default', null)
      addThingTexture(this, 'thing-default', null)
      this.viewPlaceId = selected
      this.showRoom(selected)
      if (outline) this.mergeOutline(outline)
      else if (selected !== null) this.outlineResolutions = { ...this.outlineResolutions, [selected]: 'unmergeable' }
      if (selected !== null) this.outlineReads.add(selected)
      this.observeLooking(census)
      this.prepareRoomPresentation(); this.drawThings(); this.drawResidents()
      await this.loadDrawings(census.filter(row => row.current_place_id === selected))
      this.liveReadError = false
      document.body.dataset['liveReady'] = 'true'
      this.updateHud()
      this.pollTimer = window.setTimeout(() => void this.pollLive(), 30_000)
    } catch (error) {
      console.error(error)
      this.liveReadError = true
      document.body.dataset['liveReady'] = 'error'
      this.updateHud()
      this.pollTimer = window.setTimeout(() => void this.loadCity(), 30_000)
    }
  }
  private connectActivityLog(): void {
    if (!this.placePlan || !this.layout) return
    this.removeActivityShutdown()
    this.activity?.destroy(); this.activityLog?.destroy()
    let knownCensus = this.census; let knownPlaces = this.places
    let context = createActivityContext(knownCensus, knownPlaces, place => place.name)
    const base = (): ActivityContext => {
      if (knownCensus !== this.census || knownPlaces !== this.places) {
        knownCensus = this.census; knownPlaces = this.places
        context = createActivityContext(knownCensus, knownPlaces, place => place.name)
      }
      return context
    }
    const currentResident = (id: number | undefined) => {
      const row = id === undefined ? undefined : this.residents?.residents[id]
      return row ? { type: 'resident' as const, id: row.id, name: row.handle, hasDrawing: null } : null
    }
    const dynamic: ActivityContext = {
      resident: actor => base().resident(actor) ?? currentResident(this.residents?.actors.get(actor.trim())),
      residentById: id => base().residentById?.(id) ?? currentResident(id),
      place: id => base().place(id), roomName: (id, time) => base().roomName(id, time),
      actorRoom: actor => { const id = this.residents?.actors.get(actor); return id === undefined ? null : this.residents?.residents[id]?.placeId ?? null },
      thing: id => { const thing = this.things?.things[id]; return thing ? { entity: { type: 'thing', id,
        name: thing.name ?? this.thingNames.get(id) ?? `thing #${id}`, hasDrawing: null }, placeId: thing.placeId } : null },
      placementVisibility: subject => {
        const id = subject.type === 'actor' ? dynamic.actorRoom?.(subject.actor, Date.now())
          : subject.type === 'thing' ? this.things?.things[subject.id]?.placeId : null
        return id == null ? 'unknown' : roomIsPublic(this.layout!, id) ? 'public' : 'hidden'
      },
    }
    this.activityBase = dynamic
    this.activityLog = new RoomActivityLine(document.getElementById('room-activity')!, dynamic)
    this.activity = new SceneActivity(this, this.activityLog, dynamic)
    const log = this.activityLog; const activity = this.activity
    this.removeActivityShutdown = removableOnce(this.events, Phaser.Scenes.Events.SHUTDOWN, () => { activity.destroy(); log.destroy() })
  }
  private async loadDrawings(census: readonly Resident[]): Promise<void> {
    const visible = Object.fromEntries(Object.entries(this.residents?.residents ?? {})
      .filter(([, row]) => row.placeId === this.viewPlaceId && !this.sleepers.has(row.id)))
    await readResidentDrawings(census.filter(row => visible[row.id]), visible, this.readResidentDrawing, (id, art) => {
      addDrawingTexture(this, `resident-${id}`, art); this.figures.get(id)?.sprite.setTexture(`resident-${id}`)
    }, message => this.thingReadIssue(message))
  }
  private async loadPlaceDrawings(): Promise<void> {
    const id = this.viewPlaceId
    if (id === null || !this.layout || !roomIsPublic(this.layout, id)) return
    this.placeDrawingReads += 1
    try {
      const art = await this.readPlaceDrawing(id)
      if (art && this.viewPlaceId === id) this.rooms?.addDrawing(this, id, art)
    } catch (error) { console.error(error); this.thingReadIssue('This room drawing could not be read.') }
    finally { this.placeDrawingReads -= 1 }
  }
  update(_time: number, delta: number): void {
    if (!this.clock || !this.residents || !this.layout) return
    this.configureRoomMotion()
    const pauseFrame = pauseAdvance(animationDelta(delta, { ready: document.body.dataset['liveReady'] === 'true',
      paused: this.paused, jumping: false, readFailed: this.liveReadError, presenceLost: false }), this.elapsed, this.pauseDeadline)
    const elapsed = pauseFrame.delta
    if (elapsed > 0) {
      this.elapsed += elapsed
      this.clock = { ...this.clock, time: Date.now() }
      this.placeAnimations = stepPlaceAnimations(this.placeAnimations, [], this.elapsed)
      if (this.pauseDeadline === null && !blocksLiveDelivery(this.residents) && !this.things?.pending
        && (!this.handoverFrame || !blocksLiveHandoverDelivery(this.handoverFrame)) && this.liveQueue.length) {
        const firstAt = this.liveQueue[0]!.at
        const count = this.liveQueue.findIndex(row => row.at !== firstAt)
        const incoming = this.liveQueue.slice(0, count < 0 ? this.liveQueue.length : count)
        this.liveQueue = this.liveQueue.slice(incoming.length)
        this.liveDeliveredMarker = Math.max(this.liveDeliveredMarker, ...incoming.map(row => Number(row.change_id)))
        if (this.fixtureMode) this.liveDeliveryCounts = { ...this.liveDeliveryCounts,
          ...Object.fromEntries(incoming.map(row => [row.change_id, (this.liveDeliveryCounts[row.change_id] ?? 0) + 1])) }
        this.prepareLiveEvents(incoming)
        this.applyEvents(incoming, elapsed)
      } else this.applyEvents([], elapsed)
      this.roomMotion.idle(this.residents.residents, elapsed, this.elapsed, this.sleepers)
    }
    if (pauseFrame.paused) { this.paused = true; this.pauseDeadline = null }
    if (!this.liveReadError) {
      this.updateFollowCamera(); this.updateRooms(); this.updateOutlines()
      this.prepareRoomPresentation(); this.drawThings(); this.drawResidents(); this.drawHandovers()
      this.sounds.update(this.elapsed, this.paused, this.residents, this.figures, this.placeAnimations, this.layout, this.cameras.main)
      this.activity?.update(this.roomResidents, this.roomThings, this.displayLayout ?? this.layout, this.displayHiddenRooms(),
        this.elapsed, 1, !this.paused ? Date.now() : undefined, roomAnchorPair(this.layout, this.displayLayout, this.viewPlaceId))
      this.inventionLayer?.update(this.inventions, { ...this.residents, residents: this.roomResidents }, this.displayHiddenRooms(), 1)
    }
    this.updateHud()
  }
  private async pollLive(): Promise<void> {
    if (this.polling || !this.liveState || !this.layout || !this.residents || !this.activityBase) return
    if (this.paused || this.pauseDeadline !== null) {
      this.pollTimer = window.setTimeout(() => void this.pollLive(), 30_000); return
    }
    this.polling = true
    const generation = this.pollGeneration
    let delay = 30_000
    try {
      const { snapshot, state: nextState, events } = await readCurrentUpdate(this.liveState, async () => {
        const [census, directory] = await Promise.all([fetchCensus(), fetchCurrentPlaces()])
        const outlineId = this.viewPlaceId
        const candidateLayout = nestedLayout(directory)
        const outline = outlineId !== null && roomIsPublic(candidateLayout, outlineId) ? await this.readOutline(outlineId) : null
        return { census, outlineId, outline, places: placesAfterOutline(directory, outline) }
      }, fetchChanges, Date.now)
      const { census, outlineId, outline, places } = snapshot
      const identities = createActivityContext(census, places, place => place.name)
      const visibleLayout = nestedLayout(places)
      const context: ActivityContext = { ...this.activityBase, resident: identities.resident,
        residentById: identities.residentById, place: identities.place, roomName: identities.roomName,
        placementVisibility: subject => {
          const id = subject.type === 'actor' ? this.activityBase?.actorRoom?.(subject.actor, Date.now())
            : subject.type === 'thing' ? this.things?.things[subject.id]?.placeId : null
          return id == null ? 'unknown' : roomIsPublic(visibleLayout, id) ? 'public' : 'hidden'
        },
      }
      const seen = outlineId === null ? [] : witnessedEvents(events, context, outlineId)
      const enriched = await this.enrichNotes(seen, visibleLayout)
      await this.loadAgreementPairs(enriched)
      if (generation !== this.pollGeneration || this.paused || this.pauseDeadline !== null) return
      // A refresh can report a destination before its witnessed walk has played.
      const protectedIds = new Set(Object.values(this.residents.residents).filter(row => row.walking || row.queue.some(item => item.event.kind !== 'note')).map(row => row.id))
      for (const event of [...this.liveQueue, ...enriched]) if (event.kind === 'action' && event.detail.status === 'applied'
        && ['move', 'go_home'].includes(String(event.detail.action)) && event.actor) {
        const id = this.residents.actors.get(event.actor); if (id !== undefined) protectedIds.add(id)
      }
      const tree = (rows: readonly ReplayPlace[]): string => JSON.stringify([...rows].sort((a, b) => a.id - b.id)
        .map(place => [place.id, place.parent_id, place.quiet]))
      if (tree(places) !== tree(this.places)) this.layout = nestedLayout(places, this.roomCapacities)
      this.places = places; this.placePlan = currentPlacePlan(places)
      this.updateRooms()
      const refreshed = refreshPresentResidents(this.residents, census, this.layout, protectedIds)
      this.residents = prepareLiveResidents(refreshed.state, events)
      this.roomMotion.forgetResidents(refreshed.snappedIds)
      this.observeLooking(census)
      this.liveState = nextState; this.liveReadError = false
      this.liveQueue = Object.freeze([...this.liveQueue, ...eventsAfterMarker(enriched, this.liveDeliveredMarker)])
      // The log records the observation now, even if its visual is queued behind another note.
      this.activity?.consume(enriched, Number.POSITIVE_INFINITY, this.elapsed)
      if (outline && this.roomHasMotion(outline.placeId)) this.outlinePending.set(outline.placeId, outline)
      else if (outline) this.mergeOutline(outline)
      else if (outlineId !== null) this.outlineResolutions = { ...this.outlineResolutions, [outlineId]: 'unmergeable' }
      this.liveCaughtUp = true
      this.updateFollowCamera(); this.showRoom(this.viewPlaceId)
      this.prepareRoomPresentation(); this.drawThings(); this.drawResidents()
      if (this.fixtureMode) document.body.dataset['livePoll'] = 'true'
    } catch (error) {
      console.error(error)
      this.liveState = liveReadFailed(this.liveState)
      this.liveReadError = true
      delay = this.liveState.retryMs ?? 30_000
    } finally {
      if (generation === this.pollGeneration) {
        this.polling = false; this.updateHud()
        window.clearTimeout(this.pollTimer)
        this.pollTimer = window.setTimeout(() => void this.pollLive(), delay)
      }
    }
  }
  private async enrichNotes(events: readonly ReplayEvent[], layout: NestedLayout): Promise<readonly ReplayEvent[]> {
    return readNoteWords(events, layout, this.readNote, message => this.thingReadIssue(message))
  }
  private async loadAgreementPairs(events: readonly ReplayEvent[]): Promise<void> {
    const result = await readAgreementPairs(events, this.readAgreement, this.agreementPairs)
    this.agreementPairs = result.pairs; if (result.failed) this.thingReadIssue('Some agreement parties could not be read; those signatures could not be shown.')
  }
  private prepareLiveEvents(events: readonly ReplayEvent[]): void {
    if (!this.layout || !this.residents || !this.things) return
    const blockers: Record<number, StageStandingSpot[]> = {}
    for (const resident of Object.values(this.residents.residents)) {
      if (this.sleepers.has(resident.id) || resident.placeId === null || !resident.visible) continue
      ;(blockers[resident.placeId] ??= []).push(residentReservationFootprint(`resident:${resident.id}`, resident))
    }
    this.things = reserveLiveThingEvents(this.things, events, this.layout, blockers as ThingReservations)
    this.residents = prepareLiveResidents({ ...this.residents, reservations: this.things.reservations }, events)
    const carries = createHandovers([...events, ...this.liveQueue]).carries
    if (this.handovers) this.handovers = { ...this.handovers, carries: [...this.handovers.carries, ...carries]
      .filter((row, index, all) => all.findIndex(other => other.noticeChangeId === row.noticeChangeId) === index) }
    for (const event of events) {
      const id = event.detail.place_id
      if (typeof id !== 'number' || !this.layout.rooms[id]) continue
      const kind = event.kind === 'place_created' ? 'founding' : event.kind === 'place_renamed' ? 'renaming' : null
      if (kind) this.placeAnimations = stepPlaceAnimations(this.placeAnimations,
        [placeAnimation(kind, id, event.change_id, this.elapsed, motionSpeed(1))], this.elapsed)
    }
  }
  private applyEvents(events: readonly ReplayEvent[], elapsed: number): void {
    if (!this.layout || !this.residents || !this.things || !this.handovers || !this.clock) return
    this.residents = stepResidents(this.residents, events, elapsed, this.elapsed, this.layout, this.clock.speed, this.agreementPairs, row => this.isResidentDrawn(row), {
      startMove: (resident, event, all) => this.roomMotion.start(resident, event, all),
      advanceMove: (resident, delta) => this.roomMotion.advance(resident, delta), allowStarts: this.pauseDeadline === null,
      sleepers: this.sleepers,
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
    const changes = sleepTransitions(this.census, census)
    this.census = census
    this.sleepers = sleepingResidents(census)
    if (this.residents) this.residents = dropSleepingResidentBubbles(this.residents, this.sleepers)
    const follow = followRoomState(this.following, this.viewPlaceId, this.residents?.residents ?? {}, this.sleepers)
    this.following = follow.following
    const entries = sleepActivityEntries(changes.filter(change => change.residentId !== follow.sleepingId), this.layout, Date.now())
    const sleeping = follow.sleepingId === null ? undefined : this.residents?.residents[follow.sleepingId]
    const notice = sleeping && follow.message ? sleepActivityEntries([{ residentId: sleeping.id, handle: sleeping.handle,
      placeId: follow.roomId, asleep: true }], this.layout, Date.now()).map(entry => ({ ...entry, text: follow.message! })) : []
    this.activityLog?.appendEntries([...entries, ...notice])
    this.updateFollowChoices()
    const places = new Map(Object.values(this.residents?.residents ?? {}).flatMap(row => row.placeId === null ? [] : [[row.id, row.placeId] as const]))
    this.activity?.observeLooking(census, Date.now(), !this.liveReadError && !this.paused && this.liveQueue.length === 0, places, this.contentsHidden, this.elapsed)
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
    if (!this.layout || !this.residents || !this.things || document.body.dataset['liveReady'] !== 'true') return
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
        this.liveReadError = true
        console.error(error)
        this.thingReadIssue('Some nearby room things could not be read; their floors are kept.')
      }).finally(() => { this.outlineActive -= 1 })
    }
  }
  private roomHasMotion(placeId: number): boolean {
    return this.liveQueue.some(event => [event.detail.place_id, event.detail.from_place_id, event.detail.to_place_id].includes(placeId))
      || Object.values(this.residents?.residents ?? {}).some(resident =>
        (resident.walking || resident.queue.some(row => row.event.kind !== 'note') || resident.agreementUntil != null)
        && (resident.placeId === placeId || resident.destinationId === placeId))
      || Boolean(this.things?.pending) || Boolean(this.handoverFrame?.pending)
  }
  private mergeOutline(outline: PlaceOutline): void {
    const previous = this.places.find(place => place.id === outline.placeId)
    const places = placesAfterOutline(this.places, outline)
    const updated = places.find(place => place.id === outline.placeId)
    if (previous && updated && JSON.stringify(previous) !== JSON.stringify(updated)) {
      this.places = places; this.placePlan = currentPlacePlan(places)
      this.layout = nestedLayout(places, this.roomCapacities)
      this.updateRooms()
      this.showRoom(this.viewPlaceId)
    }
    if (!this.layout || !this.residents || !this.things || outline.quiet
      || !roomIsPublic(this.layout, outline.placeId) || this.contentsHidden.has(outline.placeId)) {
      this.outlineResolutions = { ...this.outlineResolutions, [outline.placeId]: 'unmergeable' }; return
    }
    const blockers: StageStandingSpot[] = Object.values(this.residents.residents).flatMap(resident => {
      if (this.sleepers.has(resident.id)) return []
      const points = [resident.placeId === outline.placeId && resident.visible ? { key: `resident:${resident.id}`, x: resident.x, y: resident.y } : null,
        resident.destinationId === outline.placeId && resident.destination ? { key: `destination:${resident.id}`, ...resident.destination } : null]
      return points.flatMap(point => point ? [residentReservationFootprint(point.key, point)] : [])
    })
    this.things = refreshPresentThings(this.things, outline, this.layout, blockers)
    this.outlineResolutions = { ...this.outlineResolutions, [outline.placeId]: 'merged' }
    this.residents = Object.freeze({ ...this.residents, reservations: this.things.reservations })
    for (const row of outline.things) {
      if (!this.things.things[row.id]) continue
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
      this.viewPlaceId, this.following, this.contentsHidden, this.sleepers)
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
        this.places, this.viewport)
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
      if (!resident.value || !Number.isSafeInteger(id) || !this.residents?.residents[id] || this.sleepers.has(id)) return
      if (this.following !== id) this.activity?.reset()
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
    if (this.viewPlaceId !== id) this.outlineReads.delete(id)
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
    if (document.body.dataset['liveReady'] === 'true') void this.loadDrawings(this.census)
    this.updateHud()
  }
  private isResidentDrawn(resident: Simulation['residents'][number]): boolean {
    return resident.visible && !this.sleepers.has(resident.id) && resident.placeId !== null && !this.contentsHidden.has(resident.placeId)
      && Boolean(this.layout && roomIsPublic(this.layout, resident.placeId))
  }
  private updateFollowCamera(): void {
    const resident = this.following === null ? undefined : this.residents?.residents[this.following]
    if (resident?.placeId != null && !this.sleepers.has(resident.id) && resident.placeId !== this.viewPlaceId) this.showRoom(resident.placeId)
  }
  private updateFollowChoices(): void {
    const residents = awakeRoomChoices(this.residents?.residents ?? {}, this.layout, this.sleepers)
    const choices = JSON.stringify(residents)
    if (choices === this.lastFollowChoices) return
    this.lastFollowChoices = choices
    const picker = document.querySelector<HTMLSelectElement>('#follow-picker')!
    const prompt = new Option('Follow a resident…', ''); prompt.disabled = true
    picker.replaceChildren(prompt, ...residents.map(row => new Option(row.name, String(row.id))))
  }
  private displayHiddenRooms(): ReadonlySet<number> {
    return new Set(Object.keys(this.layout?.rooms ?? {}).map(Number)
      .filter(id => id !== this.viewPlaceId || !this.displayLayout?.rooms[id] || this.contentsHidden.has(id) || !roomIsPublic(this.layout!, id)))
  }
  private updateHud(): void {
    const ready = document.body.dataset['liveReady'] === 'true'
    const failed = this.liveReadError || document.body.dataset['liveReady'] === 'error'
    document.body.dataset['liveMode'] = 'live'
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
    }) || this.readIssues[0] || ''
    const picker = document.querySelector<HTMLSelectElement>('#place-picker')!
    const places = this.places.map(place => ({ ...place,
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
