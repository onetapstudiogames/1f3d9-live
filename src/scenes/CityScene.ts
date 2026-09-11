import Phaser from 'phaser'
import { createDrawingLoader, createThingLoader, fetchPlaceOutline } from '../city/api.ts'
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
import { contentHiddenRooms, placeAnimation, stepPlaceAnimations, type PlaceAnimation } from '../place-animation.ts'
import { createNoteExcerptLoader, fetchChanges } from '../city/changes.ts'
import { liveReadFailed, type LiveReadState } from '../live.ts'
import { readCurrentStart, readCurrentUpdate } from '../current-read.ts'
import { readCurrentSnapshot } from '../city/current-snapshot.ts'
import { readWitnessedRoom } from '../witness-current-room.ts'
import { readOptionalOutline, readIssuesAfterCycle } from '../read-issues.ts'
import { LIVE_CADENCE_MS, liveReturnReason, beginCurrentReturn, type LiveReturnReason } from '../live-continuity.ts'
import { reserveLiveThingEvents, type ThingReservations } from '../things.ts'
import { stepInventions, type InventionState } from '../inventions.ts'
import { InventionLayer } from './InventionLayer.ts'
import { createAgreementPairLoader, type AgreementPair } from '../city/agreements.ts'
import { readAgreementPairs } from '../agreements.ts'
import { AgreementLayer } from './AgreementLayer.ts'
import { fixtureMode, recordSpeechFixture } from './fixture-state.ts'
import { createActivityContext, type ActivityContext } from '../activity.ts'
import { residentReservationFootprint } from '../resident-footprint.ts'
import { SceneActivity } from './SceneActivity.ts'
import { readNoteWords, readResidentDrawings, readVisibleThingDetails, rememberOutlineThingDetails,
  RESIDENT_DRAWING_RETRY_MS, residentDrawingCandidates, residentDrawingPending, thingDetailsPending } from './SceneDetails.ts'
import { fetchChangeCursor } from '../city/current.ts'
import { refreshPresentResidents } from '../current-state.ts'
import { filterCurrentVisualEvents, returnToCurrentResidents } from '../current-return.ts'
import { refreshPresentThings } from '../current-things.ts'
import { placesAfterOutline } from '../current-room.ts'
import { awakeRoomChoices, followRoomState } from '../room-follow.ts'
import { parseRoomLink, resolveRoomLink, replaceRoomLink, type RoomLinkSelection } from '../room-links.ts'

import { singleRoomLayout, roomViewportUsable, roomIsPublic } from '../room-view.ts'
import { RoomActivityLine } from './RoomActivityLine.ts'
import { animationDelta, eventsAfterMarker, roomPictureSettled, roomPictureAccess, roomStatus, type OutlineResolution } from '../live-presentation.ts'
import { presentRoom, roomFigurePriority, roomNameLabelPriority } from '../room-presentation.ts'
import { roomLabelFitsViewport, visibleRoomLabels, type RoomCrowdingState } from '../room-crowding.ts'
import { projectRoomHandovers, roomAnchorPair } from '../room-anchors.ts'
import { removableOnce } from '../scene-lifecycle.ts'
import { hiddenRoomSpeech } from '../room-speech.ts'
import { positionSpeechLayer } from './BubbleView.ts'
import { RoomCanvas } from './RoomCanvas.ts'
import { RoomMotion } from './RoomMotion.ts'
import { actionFloorEvents, type HeldActionThingEvent } from '../action-delivery.ts'
import { positionNameLayer } from './NameReveal.ts'

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
  private returnReason: LiveReturnReason | null = null
  private lastFrameAt: number | null = null
  private wasHidden = false
  private issueCycle = 0
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
  private thingDrawingReads = new Set<number>()
  private thingDrawingHints = new Map<number, boolean | undefined>()
  private readingThings = false
  private readonly readThing = createThingLoader()
  private readonly readThingDrawing = createDrawingLoader(undefined, 'thing')
  private readonly readOutline = fetchPlaceOutline
  private outlineReads = new Set<number>()
  private outlineResolutions: Readonly<Record<number, OutlineResolution>> = {}
  private outlineActive = 0
  private outlinePending = new Map<number, PlaceOutline>()
  private outlineGeneration = 0
  private rooms?: RoomView
  private displayLayout?: NestedLayout
  private roomCrowding?: RoomCrowdingState
  private roomMotion = new RoomMotion()
  private heldActionThings: readonly HeldActionThingEvent[] = []
  private canvas?: RoomCanvas
  private get viewport(): Readonly<{ width: number; height: number }> { return this.canvas?.frame ?? { width: 0, height: 0 } }
  private layoutRevision = 0
  private roomResidents: Simulation['residents'] = {}
  private roomThings: ThingSimulation['things'] = {}
  private readonly readResidentDrawing = createDrawingLoader()
  private residentDrawingResolved = new Set<number>()
  private residentDrawingLoading = new Set<number>()
  private residentDrawingRetryAt = new Map<number, number>()
  private readonly readPlaceDrawing = createDrawingLoader(undefined, 'place')
  private placeDrawingReads = 0
  private activityLog?: RoomActivityLine
  private removeActivityShutdown = (): void => {}
  private activity?: SceneActivity
  private activityBase?: ActivityContext
  private placeAnimations: readonly PlaceAnimation[] = []
  private contentsHidden: ReadonlySet<number> = new Set()
  private figures = new Map<number, ResidentView>()
  private sleepers: ReadonlySet<number> = new Set()
  private lastFollowChoices = ''
  private elapsed = 0
  private following: number | null = null
  private readonly openingLink = parseRoomLink(window.location.search)
  private openingNotice: string | null = null
  private viewPlaceId: number | null = null
  private readIssues: readonly string[] = []
  private lastFigures = ''
  private readonly fixtureMode = fixtureMode()
  constructor() { super('city') }
  create(): void {
    document.body.dataset['liveReady'] = 'loading'
    document.body.dataset['liveFollowing'] = ''
    document.body.dataset['liveMode'] = 'live'
    this.connectControls()
    this.wasHidden = document.hidden
    const visibility = (): void => {
      const reason = liveReturnReason({ kind: 'visibility', wasHidden: this.wasHidden, hidden: document.hidden })
      this.wasHidden = document.hidden
      if (document.hidden) this.requestCurrentReturn('visibility')
      else if (reason) this.requestCurrentReturn(reason)
    }
    document.addEventListener('visibilitychange', visibility)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => document.removeEventListener('visibilitychange', visibility))
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.pollGeneration += 1; window.clearTimeout(this.pollTimer) })
    this.canvas = new RoomCanvas(this, () => this.showRoom(this.viewPlaceId))
    void this.loadCity()
  }
  private async loadCity(): Promise<void> {
    try {
      const issues: string[] = []
      const { cursor: marker, snapshot } = await readCurrentStart(fetchChangeCursor, () => this.readSnapshot(true, issues))
      const { census, places, capacity, layout, outline, outlineId: selected } = snapshot
      this.commitIssues(issues)
      this.places = places; this.census = census; this.layout = layout; this.roomCapacities = capacity
      this.liveReadError = false
      this.sleepers = sleepingResidents(census)
      this.things = Object.freeze({ things: {}, reservations: {}, issues: [], queue: [], pending: false })
      this.residents = createPresentResidents(census, layout)
      this.handovers = createHandovers([])
      this.connectActivityLine()
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
      this.lastFrameAt = performance.now()
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
  private readSnapshot(opening: boolean, issues: string[]) {
    return readCurrentSnapshot(this.readOutline, (places, census) => {
      if (opening) {
        const selection = resolveRoomLink(this.openingLink, places, census)
        this.following = selection.following; this.openingNotice = selection.message
        return selection.roomId
      }
      return this.returnReason && this.following !== null
        ? census.find(row => row.id === this.following)?.current_place_id ?? this.viewPlaceId
        : this.viewPlaceId
    }, message => issues.push(message), opening ? undefined : this.roomCapacities)
  }
  private commitIssues(issues: readonly string[]): void {
    this.issueCycle += 1
    this.readIssues = readIssuesAfterCycle(this.readIssues, issues, true)
  }
  private requestCurrentReturn(reason: LiveReturnReason): void {
    if (!this.liveState) return
    const next = beginCurrentReturn({ returnReason: this.returnReason, liveQueue: this.liveQueue,
      pollGeneration: this.pollGeneration, polling: this.polling }, reason, document.hidden)
    this.returnReason = next.state.returnReason; this.liveQueue = next.state.liveQueue
    this.pollGeneration = next.state.pollGeneration; this.polling = next.state.polling
    window.clearTimeout(this.pollTimer)
    if (next.readNow) void this.pollLive()
  }
  private connectActivityLine(): void {
    if (!this.layout) return
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
    const cycle = this.issueCycle
    const visibleIds = new Set(Object.values(this.roomResidents).filter(row => row.visible && !this.sleepers.has(row.id)).map(row => row.id))
    const now = Date.now()
    const pending = residentDrawingCandidates(census, visibleIds, this.residentDrawingResolved,
      this.residentDrawingLoading, this.residentDrawingRetryAt, now)
    if (!pending.length) return
    for (const row of pending) this.residentDrawingLoading.add(row.id)
    const priority = new Set(this.following === null ? [] : [this.following])
    const pendingIds = new Set(pending.map(row => row.id))
    const pendingResidents = Object.fromEntries(Object.entries(this.roomResidents)
      .filter(([id]) => pendingIds.has(Number(id))))
    try {
      const failed = await readResidentDrawings(pending, pendingResidents, this.readResidentDrawing, (id, art) => {
        this.residentDrawingResolved.add(id)
        this.residentDrawingRetryAt.delete(id)
        addDrawingTexture(this, `resident-${id}`, art)
        this.figures.get(id)?.sprite.setTexture(`resident-${id}`).clearTint()
      }, message => this.thingReadIssue(message, cycle), priority)
      for (const id of failed) this.residentDrawingRetryAt.set(id, Date.now() + RESIDENT_DRAWING_RETRY_MS)
    } finally { for (const row of pending) this.residentDrawingLoading.delete(row.id) }
  }
  private async loadPlaceDrawings(): Promise<void> {
    const cycle = this.issueCycle
    const id = this.viewPlaceId
    if (id === null || !this.layout || !roomIsPublic(this.layout, id)) return
    this.placeDrawingReads += 1
    try {
      const art = await this.readPlaceDrawing(id)
      if (art && this.viewPlaceId === id) this.rooms?.addDrawing(this, id, art)
    } catch (error) { console.error(error); this.thingReadIssue('This room drawing could not be read.', cycle) }
    finally { this.placeDrawingReads -= 1 }
  }
  update(): void {
    if (!this.residents || !this.layout) return
    const now = performance.now()
    const reason = liveReturnReason({ kind: 'frame', lastFrameAt: this.lastFrameAt, now })
    const frameElapsed = this.lastFrameAt === null ? 0 : now - this.lastFrameAt
    this.lastFrameAt = now
    if (reason && !this.returnReason) this.requestCurrentReturn(reason)
    if (this.returnReason || document.hidden) { this.updateHud(); return }
    this.configureRoomMotion()
    const elapsed = animationDelta(frameElapsed, { ready: document.body.dataset['liveReady'] === 'true',
      readFailed: this.liveReadError })
    if (elapsed > 0) {
      this.elapsed += elapsed
      this.placeAnimations = stepPlaceAnimations(this.placeAnimations, [], this.elapsed)
      if (!blocksLiveDelivery(this.residents) && !this.things?.pending
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
    if (!this.liveReadError) {
      this.updateFollowRoom(); this.updateRooms(); this.updateOutlines()
      this.prepareRoomPresentation(); this.drawThings(); this.drawResidents(); this.drawHandovers()
      this.activity?.update(this.roomResidents, this.roomThings, this.displayLayout ?? this.layout, this.displayHiddenRooms(),
        this.elapsed, 1, Date.now(), roomAnchorPair(this.layout, this.displayLayout, this.viewPlaceId))
      this.inventionLayer?.update(this.inventions, { ...this.residents, residents: this.roomResidents }, this.displayHiddenRooms(), 1)
    }
    this.updateHud()
  }
  private async pollLive(): Promise<void> {
    if (this.polling || !this.liveState || !this.layout || !this.residents || !this.activityBase) return
    if (document.hidden) {
      this.pollTimer = window.setTimeout(() => void this.pollLive(), 30_000); return
    }
    this.polling = true
    const generation = this.pollGeneration
    const returning = this.returnReason
    const issues: string[] = []
    let delay = 30_000
    try {
      const readSnapshot = () => this.readSnapshot(false, issues)
      const fresh = returning ? await readCurrentStart(fetchChangeCursor, readSnapshot) : null
      const { snapshot, state: nextState, events } = fresh ? {
        snapshot: fresh.snapshot, state: { marker: fresh.cursor, seen: new Set<string>(), failures: 0,
          lastReadAt: Date.now(), retryMs: LIVE_CADENCE_MS }, events: [],
      } : await readCurrentUpdate(this.liveState, readSnapshot, fetchChanges, Date.now)
      const { census, outlineId, outline, places } = snapshot
      const identities = createActivityContext(census, places, place => place.name)
      const observed = prepareLiveResidents(this.residents, events)
      const identity: ActivityContext['resident'] = actor => {
        const row = observed.residents[observed.actors.get(actor.trim()) ?? -1]
        return identities.resident(actor) ?? (row ? { type: 'resident', id: row.id, name: row.handle, hasDrawing: null } : null)
      }
      const visibleLayout = nestedLayout(places)
      const context: ActivityContext = { ...this.activityBase, resident: identity,
        residentById: identities.residentById, place: identities.place, roomName: identities.roomName,
        placementVisibility: subject => {
          const id = subject.type === 'actor' ? this.activityBase?.actorRoom?.(subject.actor, Date.now())
            : subject.type === 'thing' ? this.things?.things[subject.id]?.placeId : null
          return id == null ? 'unknown' : roomIsPublic(visibleLayout, id) ? 'public' : 'hidden'
        },
      }
      const enriched = await readWitnessedRoom(events, context, () => this.viewPlaceId, async seen => {
        const rows = await readNoteWords(seen, visibleLayout, this.readNote, message => issues.push(message))
        const pairs = await readAgreementPairs(rows, this.readAgreement, this.agreementPairs)
        this.agreementPairs = pairs.pairs
        if (pairs.failed) issues.push('Some agreement parties could not be read; those signatures could not be shown.')
        return rows
      }, () => generation !== this.pollGeneration)
      if (generation !== this.pollGeneration) return
      this.activity?.witness(enriched, Date.now(), context, this.elapsed)
      this.commitIssues(issues)
      this.liveState = nextState; this.liveReadError = false
      const visual = filterCurrentVisualEvents(this.residents, this.liveQueue, enriched)
      // A refresh can report a destination before its witnessed walk has played.
      const protectedIds = new Set(Object.values(this.residents.residents).filter(row => row.walking || row.actionUntil != null || row.queue.some(item => item.event.kind !== 'note')).map(row => row.id))
      for (const event of [...this.liveQueue, ...visual]) if (event.kind === 'action' && event.detail.status === 'applied'
        && ['move', 'go_home'].includes(String(event.detail.action)) && event.actor) {
        const id = this.residents.actors.get(event.actor); if (id !== undefined) protectedIds.add(id)
      }
      const tree = (rows: readonly ReplayPlace[]): string => JSON.stringify([...rows].sort((a, b) => a.id - b.id)
        .map(place => [place.id, place.parent_id, place.quiet]))
      if (tree(places) !== tree(this.places)) this.layout = nestedLayout(places, this.roomCapacities)
      this.places = places
      this.updateRooms()
      if (returning) this.resetCurrentPicture(census)
      const refreshed = refreshPresentResidents(this.residents, census, this.layout, protectedIds)
      this.residents = prepareLiveResidents(refreshed.state, events)
      this.roomMotion.forgetResidents(refreshed.snappedIds)
      this.observeLooking(census)
      this.liveQueue = Object.freeze([...this.liveQueue, ...eventsAfterMarker(visual, this.liveDeliveredMarker)])
      if (outline && this.roomHasMotion(outline.placeId)) this.outlinePending.set(outline.placeId, outline)
      else if (outline) this.mergeOutline(outline)
      else if (outlineId !== null) this.outlineResolutions = { ...this.outlineResolutions, [outlineId]: 'unmergeable' }
      this.liveCaughtUp = true
      if (returning) {
        this.liveDeliveredMarker = Number(nextState.marker)
        this.returnReason = null; this.lastFrameAt = performance.now()
      }
      this.updateFollowRoom(); this.showRoom(this.viewPlaceId)
      this.prepareRoomPresentation(); this.drawThings(); this.drawResidents()
      if (this.fixtureMode) document.body.dataset['livePoll'] = 'true'
    } catch (error) {
      if (generation !== this.pollGeneration) return
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
  private resetCurrentPicture(census: readonly Resident[]): void {
    this.residents = returnToCurrentResidents(this.residents!, census, this.layout!, {})
    if (this.things) this.things = { ...this.things, queue: [], pending: false,
      things: Object.fromEntries(Object.entries(this.things.things).map(([id, row]) => [id, { ...row, effect: null }])) }
    this.roomMotion = new RoomMotion(); this.roomCrowding = undefined; this.heldActionThings = []
    this.outlineGeneration += 1; this.outlinePending.clear()
    this.handovers = createHandovers([]); this.handoverFrame = undefined; this.handoverLayer.clear()
    this.inventions = { moments: [], pending: false, issues: [] }; this.inventionLayer?.clear(); this.agreementLayer.clear()
    this.placeAnimations = []; this.activity?.resetPresentation()
    // Reconnection observes current presence, never sleep or looking changes during the absence.
    this.census = census
    if (this.following !== null && sleepingResidents(census).has(this.following)) this.following = null
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
        [placeAnimation(kind, id, event.change_id, this.elapsed)], this.elapsed)
    }
  }
  private applyEvents(events: readonly ReplayEvent[], elapsed: number): void {
    if (!this.layout || !this.residents || !this.things || !this.handovers) return
    this.residents = stepResidents(this.residents, events, elapsed, this.elapsed, this.layout, this.agreementPairs, row => this.isResidentDrawn(row), {
      startMove: (resident, event, all) => this.roomMotion.start(resident, event, all),
      advanceMove: (resident, delta) => this.roomMotion.advance(resident, delta),
      startAction: (resident, event, all, now) => this.things?.things[Number(event.detail.source_thing_id)]?.effect
        ? null : this.roomMotion.startAction(resident, event, all, now),
      advanceAction: (resident, delta, now) => this.roomMotion.advanceAction(resident, delta, now),
      sleepers: this.sleepers,
    })
    this.agreementLayer.add(this.residents.startedHandshakes ?? [])
    this.inventions = stepInventions(this.inventions, this.residents.startedInventions ?? [], this.residents,
      this.contentsHidden, this.elapsed)
    this.handoverFrame = stepHandovers(this.handovers, events, this.residents, this.layout, this.elapsed)
    this.handovers = this.handoverFrame.state
    const floor = actionFloorEvents(this.heldActionThings, this.handoverFrame.floorEvents, this.residents.residents)
    this.heldActionThings = floor.held
    this.things = stepThings(this.things, floor.events, this.elapsed)
    const started = this.residents.startedEvents ?? []
    const represented = new Set(started.filter(event => {
      const id = event.actor ? this.residents!.actors.get(event.actor.trim()) : undefined
      const actor = id === undefined ? undefined : this.residents!.residents[id]
      return actor?.walkEventId === event.change_id && actor.walking
        || actor?.actionEvent?.change_id === event.change_id
        || event.kind === 'note' && (actor?.bubble?.noteId === event.detail.note_id || Boolean(actor?.showingNotice))
        || actor?.lastActivityId === event.change_id && Boolean(actor?.sparkle || actor?.inventionUntil || actor?.agreementUntil || actor?.transferUntil || actor?.blockedAttempt)
        || Boolean(this.things!.things[Number(event.detail.thing_id ?? event.detail.source_thing_id)]?.effect)
        || this.placeAnimations.some(row => row.changeId === event.change_id)
    }).map(event => event.change_id))
    this.activity?.animate([...started, ...events.filter(event => !event.actor)], Date.now(), this.elapsed, represented)
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
    this.activity?.observeLooking(census, Date.now(), !this.liveReadError && this.liveQueue.length === 0, places, this.contentsHidden, this.elapsed)
  }
  private updateRooms(): void {
    if (!this.layout) return
    this.contentsHidden = contentHiddenRooms(this.layout, this.placeAnimations)
    this.rooms?.update(this.cameras.main, Date.now(), this.contentsHidden)
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
      const shake = this.roomMotion.actionFrames().find(frame => frame.thingId === thing.id)?.offsetX ?? 0
      // The thing rattles against the resident, not with it: opposite phase.
      view.update(shake ? { ...thing, x: thing.x - shake } : thing,
        thing.name ?? this.thingNames.get(thing.id) ?? null, zoom, this.elapsed, this.handoverFrame?.carryThingIds.includes(thing.id) ?? false)
    }
    document.body.dataset['liveThingsCount'] = String([...this.thingViews.values()].filter(view => view.sprite.visible).length)
    if (document.body.dataset['liveReady'] === 'true') void this.loadThingDetails()
    if (this.fixtureMode) {
      document.body.dataset['liveThings'] = JSON.stringify(this.shownThings().map(thing => ({
        id: thing.id, name: thing.name ?? this.thingNames.get(thing.id) ?? null,
        x: this.thingViews.get(thing.id)!.sprite.x, y: this.thingViews.get(thing.id)!.sprite.y,
        texture: this.thingViews.get(thing.id)!.sprite.texture.key,
        effect: thing.effect?.kind ?? null,
        width: this.thingViews.get(thing.id)!.sprite.displayWidth, height: this.thingViews.get(thing.id)!.sprite.displayHeight,
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
      const cycle = this.issueCycle
      this.outlineReads.add(room.id)
      this.outlineActive += 1
      void readOptionalOutline(room.id, this.readOutline).then(({ outline, issue }) => {
        if (generation !== this.outlineGeneration || cycle !== this.issueCycle) return
        if (issue) this.thingReadIssue(issue, cycle)
        if (!outline) {
          this.outlineResolutions = { ...this.outlineResolutions, [room.id]: 'unmergeable' }
          return
        }
        if (this.contentsHidden.has(room.id)) {
          this.outlineResolutions = { ...this.outlineResolutions, [room.id]: 'unmergeable' }; return
        }
        if (this.roomHasMotion(room.id)) this.outlinePending.set(room.id, outline)
        else this.mergeOutline(outline)
      }).catch(error => {
        if (generation !== this.outlineGeneration || cycle !== this.issueCycle) return
        this.outlineResolutions = { ...this.outlineResolutions, [room.id]: 'unmergeable' }
        console.error(error)
        this.thingReadIssue('This room could not be drawn; its last picture is kept.', cycle)
      }).finally(() => { this.outlineActive -= 1 })
    }
  }
  private roomHasMotion(placeId: number): boolean {
    return this.liveQueue.some(event => [event.detail.place_id, event.detail.from_place_id, event.detail.to_place_id].includes(placeId))
      || Object.values(this.residents?.residents ?? {}).some(resident =>
        (resident.walking || resident.actionUntil != null || resident.queue.some(row => row.event.kind !== 'note') || resident.agreementUntil != null)
        && (resident.placeId === placeId || resident.destinationId === placeId))
      || Boolean(this.things?.pending) || Boolean(this.handoverFrame?.pending)
  }
  private mergeOutline(outline: PlaceOutline): void {
    const previous = this.places.find(place => place.id === outline.placeId)
    const places = placesAfterOutline(this.places, outline)
    const updated = places.find(place => place.id === outline.placeId)
    if (previous && updated && JSON.stringify(previous) !== JSON.stringify(updated)) {
      this.places = places
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
      rememberOutlineThingDetails(row, { namesRead: this.thingReads, drawingHints: this.thingDrawingHints,
        applyName: (id, name) => this.thingNames.set(id, name) })
    }
  }
  private drawHandovers(): void {
    const frame = this.handoverFrame && this.handovers
      ? projectRoomHandovers(this.handoverFrame, this.handovers, this.roomResidents, this.elapsed) : undefined
    this.handoverLayer.update(frame, this.handovers, this.residents, this.displayHiddenRooms())
    if (this.fixtureMode && this.handoverFrame?.motions.length) document.body.dataset['liveHandoverShown'] = 'true'
  }
  private async loadThingDetails(): Promise<void> {
    const cycle = this.issueCycle
    const reads = { namesRead: this.thingReads, drawingsRead: this.thingDrawingReads, drawingHints: this.thingDrawingHints }
    if (this.readingThings || !this.shownThings().some(thing => thingDetailsPending(thing, reads))) return
    this.readingThings = true
    try { await readVisibleThingDetails({ ...reads, shown: () => this.shownThings(), readThing: this.readThing, readDrawing: this.readThingDrawing,
      applyName: (id, name) => this.thingNames.set(id, name),
      applyDrawing: (id, art) => { addThingTexture(this, `thing-${id}`, art); this.thingViews.get(id)?.sprite.setTexture(`thing-${id}`) },
      issue: message => this.thingReadIssue(message, cycle) }) } finally { this.readingThings = false }
  }
  private shownThings() {
    if (!roomViewportUsable(this.viewport.width, this.viewport.height)) return []
    return Object.values(this.roomThings).filter(thing => thing.placeId === this.viewPlaceId && !this.contentsHidden.has(thing.placeId)
      && this.thingViews.get(thing.id)?.sprite.visible)
  }
  private thingReadIssue(message: string, cycle = this.issueCycle): void {
    if (cycle === this.issueCycle) this.readIssues = readIssuesAfterCycle(this.readIssues, [...this.readIssues, message], true)
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
      const censusResident = this.census.find(row => row.id === resident.id)
      if (residentDrawingPending(censusResident, this.residentDrawingResolved.has(resident.id))) {
        figure.sprite.setTintFill(0x858980)
      } else figure.sprite.clearTint()
      const hidden = !usable || !this.isResidentDrawn(resident) || resident.placeId !== this.viewPlaceId
      const speech = figure.update(hidden ? { ...resident, visible: false } : resident, this.elapsed,
        this.places, this.viewport, this.following === resident.id,
        this.roomMotion.actionFrames().find(frame => frame.residentId === resident.id)?.offsetX ?? 0)
      if (speech && (visibleSpeech === null || speech.residentId === this.following)) visibleSpeech = speech
    }
    const actionOffsets = new Map(this.roomMotion.actionFrames().map(frame => [frame.residentId, frame.offsetX]))
    const captionResidents = Object.fromEntries(Object.values(this.roomResidents).map(row => [row.id,
      { ...row, x: row.x + (actionOffsets.get(row.id) ?? 0) }]))
    this.activity?.updateCaptions(captionResidents, this.viewport, this.elapsed)
    positionSpeechLayer()
    positionNameLayer()
    const obstacles = [...this.figures].flatMap(([id, figure]) => figure.sprite.visible
      ? [{ ...figure.sprite.getBounds(), id: String(id) }] : [])
      .concat([...this.thingViews].flatMap(([id, thing]) => thing.sprite.visible
        ? [{ ...thing.sprite.getBounds(), id: `thing:${id}` }] : []))
    const captionPriority = this.activity?.captionPriorities(this.elapsed)
      ?? { residentIds: new Set<number>(), thingIds: new Set<number>(), movingResidentIds: new Set<number>() }
    const labels = visibleRoomLabels([...this.figures].flatMap(([id, figure]) => {
      const box = figure.labelBounds()
      return box && roomLabelFitsViewport(box, this.viewport.width, this.viewport.height)
        ? [{ ...box, id: String(id), priority: roomNameLabelPriority(roomFigurePriority(state[id]!, this.following),
          captionPriority.residentIds.has(id)) }] : []
    }).concat([...this.thingViews].flatMap(([id, thing]) => {
      const box = thing.labelBounds()
      return box && roomLabelFitsViewport(box, this.viewport.width, this.viewport.height)
        ? [{ ...box, id: `thing:${id}`, priority: roomNameLabelPriority(0, captionPriority.thingIds.has(id)) }] : []
    })), obstacles)
    for (const [id, thing] of this.thingViews) thing.setNameVisible(labels.has(`thing:${id}`))
    for (const [id, figure] of this.figures) figure.setNameVisible(labels.has(String(id)))
    this.activityLog?.setUnshownSpeech(hiddenRoomSpeech(this.residents?.residents ?? {}, this.roomResidents,
      this.layout, this.viewPlaceId, this.contentsHidden, this.elapsed, this.sleepers))
    this.agreementLayer.draw(this, this.figures, this.displayHiddenRooms())
    recordSpeechFixture(visibleSpeech, this.fixtureMode, this.agreementLayer.count)
    this.updateFollowChoices()
    if (document.body.dataset['liveReady'] === 'true') void this.loadDrawings(this.census)
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
    const link = (selection: RoomLinkSelection): void => {
      this.openingNotice = null
      replaceRoomLink(window.history, window.location.href, selection)
    }
    const clear = (): void => {
      if (this.following !== null) this.activity?.reset()
      this.following = null; link({ kind: 'none' }); this.updateHud()
    }
    const follow = (): void => {
      if (!resident.value) { clear(); return }
      const id = Number(resident.value)
      if (!Number.isSafeInteger(id) || !this.residents?.residents[id] || this.sleepers.has(id)) return
      if (this.following !== id) this.activity?.reset()
      this.following = id
      link({ kind: 'resident', handle: this.residents.residents[id].handle })
      this.updateFollowRoom()
      this.updateHud()
    }
    const stay = (): void => {
      if (!place.value) { clear(); return }
      const id = Number(place.value)
      if (!Number.isSafeInteger(id) || !this.layout?.rooms[id]) return
      this.following = null
      link({ kind: 'place', id })
      this.showRoom(id)
      this.updateHud()
    }
    resident.addEventListener('change', follow); place.addEventListener('change', stay)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      resident.removeEventListener('change', follow); place.removeEventListener('change', stay)
    })
  }
  private showRoom(id: number | null): void {
    if (id === null || !this.layout?.rooms[id]) return
    if (this.viewPlaceId !== id) { this.outlineReads.delete(id); this.activity?.resetPresentation() }
    this.viewPlaceId = id
    this.activityLog?.selectRoom(id)
    if (!roomViewportUsable(this.viewport.width, this.viewport.height)) { this.updateHud(); return }
    const source = this.layout.rooms[id]!
    this.displayLayout = singleRoomLayout({ ...source, quiet: !roomIsPublic(this.layout, id) }, this.viewport.width, this.viewport.height)
    this.roomCrowding = undefined
    this.rooms?.destroy()
    this.rooms = new RoomView(this, this.displayLayout)
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
  private updateFollowRoom(): void {
    const diagnostics = this.roomMotion.diagnostics()
    this.activity?.syncMoveCaptions(diagnostics, this.elapsed)
    const resident = this.following === null ? undefined : this.residents?.residents[this.following]
    const moveCaptionActive = resident && this.activity?.captionPriorities(this.elapsed).movingResidentIds.has(resident.id)
    if (resident?.placeId != null && !this.sleepers.has(resident.id) && resident.placeId !== this.viewPlaceId && !moveCaptionActive) {
      this.showRoom(resident.placeId)
    }
  }
  private updateFollowChoices(): void {
    const residents = awakeRoomChoices(this.residents?.residents ?? {}, this.layout, this.sleepers)
    const choices = JSON.stringify(residents)
    if (choices === this.lastFollowChoices) return
    this.lastFollowChoices = choices
    const picker = document.querySelector<HTMLSelectElement>('#follow-picker')!
    const prompt = new Option('Follow a resident…', '')
    picker.replaceChildren(prompt, ...residents.map(row => new Option(`${row.name} · resident #${row.id}`, String(row.id))))
  }
  private displayHiddenRooms(): ReadonlySet<number> {
    return new Set(Object.keys(this.layout?.rooms ?? {}).map(Number)
      .filter(id => id !== this.viewPlaceId || !this.displayLayout?.rooms[id] || this.contentsHidden.has(id) || !roomIsPublic(this.layout!, id)))
  }
  private updateHud(): void {
    const ready = document.body.dataset['liveReady'] === 'true'
    const failed = this.liveReadError || document.body.dataset['liveReady'] === 'error'
    document.body.dataset['liveMode'] = 'live'
    document.body.dataset['liveFollowing'] = this.following === null ? '' : String(this.following)
    document.body.dataset['liveRoom'] = this.viewPlaceId === null ? '' : String(this.viewPlaceId)
    document.body.dataset['liveReadError'] = String(failed)
    if (this.fixtureMode) {
      document.body.dataset['liveDeliveredMarker'] = String(this.liveDeliveredMarker)
      document.body.dataset['liveElapsed'] = String(this.elapsed)
      document.body.dataset['liveDeliveryCounts'] = JSON.stringify(this.liveDeliveryCounts)
      document.body.dataset['liveMotion'] = JSON.stringify(this.roomMotion.diagnostics())
      document.body.dataset['liveActionMotion'] = JSON.stringify(this.roomMotion.actionFrames())
    }
    const room = this.viewPlaceId === null ? undefined : this.layout?.rooms[this.viewPlaceId]
    document.body.dataset['liveLayoutRevision'] = String(this.layoutRevision)
    const { needsOutline, quiet } = roomPictureAccess(this.layout, this.viewPlaceId, this.contentsHidden)
    document.body.dataset['livePictureSettled'] = String(roomPictureSettled({
      ready: ready && Boolean(roomAnchorPair(this.layout, this.displayLayout, this.viewPlaceId) || quiet)
        && roomViewportUsable(this.viewport.width, this.viewport.height),
      firstPollMerged: this.liveCaughtUp, needsOutline,
      outline: room ? this.outlineResolutions[room.id] ?? 'pending' : 'pending',
      pendingReads: this.outlineActive + this.placeDrawingReads + Number(this.readingThings),
      pendingOutline: room ? this.outlinePending.has(room.id) : false,
    }))
    const name = room?.name ?? null
    document.getElementById('room-name')!.textContent = name ?? (failed ? 'City unavailable' : 'Opening the city…')
    document.getElementById('live-status')!.textContent = roomStatus({
      tooSmall: !roomViewportUsable(this.viewport.width, this.viewport.height), readFailed: failed,
      quiet, openingNotice: this.openingNotice, readIssue: this.readIssues[0],
    })
    const picker = document.querySelector<HTMLSelectElement>('#place-picker')!
    const places = this.places
    const signature = JSON.stringify(places.map(place => [place.id, place.name]))
    if (picker.dataset['choices'] !== signature) {
      picker.dataset['choices'] = signature
      const prompt = new Option('Stay in a place…', '')
      picker.replaceChildren(prompt, ...[...places].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
        .map(place => new Option(`${place.name} · place #${place.id}`, String(place.id))))
    }
    picker.value = this.following === null && this.viewPlaceId !== null ? String(this.viewPlaceId) : ''
    picker.disabled = !ready
    const resident = document.querySelector<HTMLSelectElement>('#follow-picker')!
    resident.value = this.following === null ? '' : String(this.following); resident.disabled = !ready
  }
}
