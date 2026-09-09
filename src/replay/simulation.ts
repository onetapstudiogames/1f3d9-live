import type { ReplayEvent, ReplayFile, Resident } from '../city/types.ts'
import { initialResidents } from '../city/residents.ts'
import type { NestedLayout, Point } from '../ground/nested.ts'
import { pointAlongPath, sidestepPath, walkPath } from '../ground/path.ts'
import { roomContains } from '../ground/room-shape.ts'
import { stageFindFreeSpots, type StageStandingSpot } from '../ground/stage-ground.ts'
import { appliedMove } from './index.ts'
import { bubbleFor, type SpeechBubble as Bubble } from '../speech.ts'
import { newcomerSpot, registrationFor, sparkleFor, type Sparkle } from '../newcomers.ts'
import type { ThingReservations } from '../things.ts'
import { transferDuration, transferFor, transferPartners, type Transfer, type TransferPartners } from '../giving.ts'
import { inventionDuration, inventionFor, type StartedInvention } from '../inventions.ts'
import { agreementSignature, handshakeDuration, planHandshake, type AgreementSignature, type HandshakeResident, type StartedHandshake } from '../agreements.ts'
import type { AgreementPair } from '../city/agreements.ts'
import { showingNoticeFor, type ShowingMoment } from '../showing.ts'
import { blockedAttemptFor, blockedAttemptDuration, type BlockMoment } from '../laws.ts'
import { residentReservationFootprint } from '../resident-footprint.ts'
import { ROOM_RESIDENT_SIZE } from '../room-appearance.ts'
import { ROOM_WALK_SPEED } from '../room-motion.ts'
import { roomNoteMayStart } from '../room-speech-queue.ts'

export type StartedTransfer = Readonly<{ transfer: Transfer; changeId: string; partners: TransferPartners; startedAt: number }>
type TransferCandidate = Readonly<{ transfer: Transfer; changeId: string; actorId: number }>
type AgreementCandidate = Readonly<{ signature: AgreementSignature; actorId: number }>

type QueuedEvent = Readonly<{ event: ReplayEvent }>

export type ResidentState = Readonly<{
  id: number
  handle: string
  joinedAt: string | null
  sparkle: Sparkle | null
  placeId: number | null
  x: number
  y: number
  flipX: boolean
  walking: boolean
  visible: boolean
  bubble: Bubble | null
  queue: readonly QueuedEvent[]
  path: readonly Point[]
  walkElapsed: number
  walkDuration: number
  destinationId: number | null
  destination: Point | null
  walkEventId: string | null
  lastActivityId?: string
  relocatedAt?: number
  transferUntil: number | null
  inventionUntil?: number | null
  agreementUntil?: number | null
  showingNotice?: ShowingMoment | null
  blockedAttempt?: BlockMoment | null
  actionUntil?: number | null
  actionEvent?: ReplayEvent | null
}>

export type Simulation = Readonly<{
  residents: Readonly<Record<number, ResidentState>>
  actors: ReadonlyMap<string, number>
  pending: boolean
  issues: readonly string[]
  reservations: ThingReservations
  startedTransfers: readonly StartedTransfer[]
  startedInventions?: readonly StartedInvention[]
  startedHandshakes?: readonly StartedHandshake[]
  startedEvents?: readonly ReplayEvent[]
}>

export type StepResidentsOptions = Readonly<{
  startMove?: (resident: ResidentState, event: ReplayEvent, all: Readonly<Record<number, ResidentState>>) => ResidentState | null | undefined
  advanceMove?: (resident: ResidentState, deltaMs: number) => ResidentState | undefined
  startAction?: (resident: ResidentState, event: ReplayEvent, all: Readonly<Record<number, ResidentState>>, nowMs: number) => ResidentState | null | undefined
  advanceAction?: (resident: ResidentState, deltaMs: number, nowMs: number) => ResidentState | undefined
  sleepers?: ReadonlySet<number>
}>

/** Clears speech cards as soon as the current census identifies their residents as asleep. */
export function dropSleepingResidentBubbles(state: Simulation, sleepers: ReadonlySet<number>): Simulation {
  const ids = Object.keys(state.residents).map(Number).filter(id => sleepers.has(id) && state.residents[id]?.bubble)
  if (!ids.length) return state
  const residents: Record<number, ResidentState> = { ...state.residents }
  for (const id of ids) residents[id] = Object.freeze({ ...residents[id]!, bubble: null })
  return Object.freeze({ ...state, residents: Object.freeze(residents), pending: Object.values(residents).some(isPending) })
}

export function createResidents(
  replay: ReplayFile,
  census: readonly Resident[],
  layout: NestedLayout,
  reservations: ThingReservations = {},
): Simulation {
  const initial = new Map(initialResidents(replay, census).map(item => [item.id, item]))
  const residents: Record<number, ResidentState> = {}
  const actors = new Map<string, number>()
  for (const resident of census) {
    if (typeof resident.handle !== 'string' || resident.handle.length === 0) continue
    actors.set(resident.handle, resident.id)
    const item = initial.get(resident.id)
    residents[resident.id] = { ...baseResident(resident.id, resident.handle, item?.placeId ?? null), joinedAt: resident.joined_at }
  }
  for (const [key, start] of Object.entries(replay.start)) {
    const match = /^resident:(\d+)$/.exec(key)
    if (!match || start === null) continue
    const id = Number(match[1])
    if (!Number.isSafeInteger(id) || residents[id]) continue
    residents[id] = baseResident(id, key, start.place_id)
  }
  // A registration names its resident even when the census cannot be read. It does not
  // place the figure early or substitute for the census join date used by the tag.
  for (const event of replay.timeline) {
    const registration = registrationFor(event)
    if (!registration) continue
    const { id, handle } = registration
    if (actors.has(handle) && actors.get(handle) !== id) continue
    if (census.some(resident => resident.id === id && resident.handle !== handle)) continue
    const resident = residents[id] ?? baseResident(id, handle, null)
    actors.set(handle, id)
    residents[id] = { ...resident, handle }
  }
  placeStationary(residents, layout, reservations)
  return freezeSimulation(residents, actors, [], false, reservations, [])
}

/** Builds the plain current picture directly from the census, without replay history. */
export function createPresentResidents(
  census: readonly Resident[],
  layout: NestedLayout,
  reservations: ThingReservations = {},
): Simulation {
  const residents: Record<number, ResidentState> = {}
  const awake: Record<number, ResidentState> = {}
  const actors = new Map<string, number>()
  for (const resident of census) {
    const handle = typeof resident.handle === 'string' ? resident.handle.trim() : ''
    if (!handle) continue
    actors.set(handle, resident.id)
    const state = { ...baseResident(resident.id, handle, resident.current_place_id), joinedAt: resident.joined_at }
    residents[resident.id] = state
    if (!resident.asleep) awake[resident.id] = state
  }
  placeStationary(awake, layout, reservations)
  // Current-room presentation owns final crowding. A stale whole-city band must still
  // supply every awake resident with a valid source point so projection can seat them.
  for (const resident of Object.values(awake)) {
    if (resident.visible || resident.placeId === null) continue
    const room = layout.rooms[resident.placeId]
    if (!room || !placeVisible(layout, resident.placeId)) continue
    awake[resident.id] = { ...resident, x: room.standing.x + room.standing.width / 2,
      y: room.standing.y + room.standing.height / 2, visible: true }
  }
  for (const [id, resident] of Object.entries(awake)) residents[Number(id)] = resident
  return freezeSimulation(residents, actors, [], false, reservations, [])
}

export function prepareLiveResidents(state: Simulation, events: readonly ReplayEvent[]): Simulation {
  const residents = { ...state.residents }
  const actors = new Map(state.actors)
  for (const event of events) {
    const registration = registrationFor(event)
    if (!registration || actors.has(registration.handle) || residents[registration.id]) continue
    actors.set(registration.handle, registration.id)
    residents[registration.id] = baseResident(registration.id, registration.handle, null)
  }
  return freezeSimulation(residents, actors, state.issues, state.pending, state.reservations, state.startedTransfers)
}

export function stepResidents(
  state: Simulation,
  events: readonly ReplayEvent[],
  deltaMs: number,
  nowMs: number,
  layout: NestedLayout,
  agreementPairs: ReadonlyMap<string, AgreementPair> = new Map(),
  canDraw?: (resident: ResidentState) => boolean,
  options: StepResidentsOptions = {},
): Simulation {
  const residents: Record<number, ResidentState> = Object.fromEntries(
    Object.entries(state.residents).map(([id, resident]) => [id, { ...resident, queue: [...resident.queue], path: [...resident.path] }]),
  )
  for (const id of options.sleepers ?? []) {
    if (residents[id]?.bubble) residents[id] = { ...residents[id]!, bubble: null }
  }
  const issues = [...state.issues]
  const candidates: TransferCandidate[] = []
  const startedInventions: StartedInvention[] = []
  const agreementCandidates: AgreementCandidate[] = []
  const startedEvents: ReplayEvent[] = []
  for (const event of events) {
    if (event.kind === 'register') {
      const registration = registrationFor(event)
      if (!registration || state.actors.get(registration.handle) !== registration.id) {
        addIssue(issues, 'registration')
        continue
      }
    }
    if (event.actor === null) continue
    const actor = typeof event.actor === 'string' ? event.actor.trim() : ''
    const id = state.actors.get(actor)
    if (id === undefined || !residents[id]) {
      addIssue(issues, event.kind === 'agreement_sign' ? 'agreement' : blockedAttemptFor(event) ? 'blocked'
        : inventionFor(event) ? 'invention' : 'actor')
      continue
    }
    residents[id] = { ...residents[id]!, queue: [...residents[id]!.queue, { event }] }
  }

  const elapsed = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0
  for (const id of Object.keys(residents).map(Number).sort((a, b) => a - b)) {
    let resident = residents[id]!
    if (resident.transferUntil !== null && nowMs >= resident.transferUntil) resident = { ...resident, transferUntil: null }
    if (resident.inventionUntil != null && nowMs >= resident.inventionUntil) resident = { ...resident, inventionUntil: null }
    if (resident.agreementUntil != null && nowMs >= resident.agreementUntil) resident = { ...resident, agreementUntil: null }
    if (resident.showingNotice && nowMs >= resident.showingNotice.expiresAt) resident = { ...resident, showingNotice: null }
    if (resident.blockedAttempt && nowMs >= resident.blockedAttempt.expiresAt) resident = { ...resident, blockedAttempt: null }
    if (resident.bubble && nowMs >= resident.bubble.expiresAt) resident = { ...resident, bubble: null }
    if (resident.sparkle && nowMs >= resident.sparkle.expiresAt) resident = { ...resident, sparkle: null }
    const action = resident.actionEvent
    if (resident.actionUntil != null) {
      resident = options.advanceAction?.(resident, elapsed, nowMs) ?? resident
    } else if (resident.walking) resident = options.advanceMove?.(resident, elapsed) ?? advanceWalk(resident, elapsed, layout)
    if (!resident.walking && !resident.bubble && !resident.sparkle && !resident.showingNotice && !resident.blockedAttempt
      && resident.transferUntil === null && resident.inventionUntil == null && resident.agreementUntil == null
      && resident.actionUntil == null && !action
      ) {
      resident = startNext(resident, residents, nowMs, layout, issues, state.reservations, candidates, startedInventions, agreementCandidates, agreementPairs, startedEvents, options)
    }
    residents[id] = resident
  }
  const startedTransfers: StartedTransfer[] = []
  for (const candidate of candidates) {
    const partners = transferPartners(candidate.transfer, residents, layout)
    if (!partners) { addIssue(issues, 'handover'); continue }
    // Both ends stand still for the float. The copy is drawn between the two figures the record
    // named, so a partner who walked off mid-float would leave the icon landing on empty floor.
    const until = nowMs + transferDuration()
    residents[candidate.actorId] = { ...residents[candidate.actorId]!, transferUntil: until }
    const partner = residents[candidate.transfer.partnerId]
    if (partner) residents[candidate.transfer.partnerId] = { ...partner, transferUntil: until }
    startedTransfers.push(Object.freeze({ transfer: candidate.transfer, changeId: candidate.changeId, partners, startedAt: nowMs }))
  }
  const startedHandshakes: StartedHandshake[] = []
  for (const candidate of agreementCandidates) {
    if (Object.values(residents).some(row => row.agreementUntil != null && row.agreementUntil > nowMs)) { addIssue(issues, 'agreement'); continue }
    const projected = Object.fromEntries(Object.values(residents).map(row => [row.id, handshakeResident(row, canDraw?.(row) ?? true)]))
    const plan = planHandshake(candidate.signature, projected, layout, state.reservations, nowMs)
    if (!plan) { addIssue(issues, 'agreement'); continue }
    const until = nowMs + handshakeDuration()
    residents[plan.leftId] = { ...residents[plan.leftId]!, agreementUntil: until }
    residents[plan.rightId] = { ...residents[plan.rightId]!, agreementUntil: until }
    startedHandshakes.push(Object.freeze({ plan }))
  }
  return Object.freeze({ ...freezeSimulation(residents, state.actors, issues, Object.values(residents).some(isPending), state.reservations, startedTransfers),
    startedInventions: Object.freeze(startedInventions), startedHandshakes: Object.freeze(startedHandshakes), startedEvents: Object.freeze(startedEvents) })
}

function startNext(
  resident: ResidentState,
  all: Readonly<Record<number, ResidentState>>,
  nowMs: number,
  layout: NestedLayout,
  issues: string[],
  reservations: ThingReservations,
  candidates: TransferCandidate[],
  startedInventions: StartedInvention[],
  agreementCandidates: AgreementCandidate[],
  agreementPairs: ReadonlyMap<string, AgreementPair>,
  startedEvents: ReplayEvent[],
  options: StepResidentsOptions,
): ResidentState {
  let next = resident
  if (!next.queue.length) return next
  // Keep every new placement and queue turn clear of the projected meeting, including
  // a note that anchors an otherwise unplaced figure. Existing words finish normally.
  if (Object.values(all).some(row => row.agreementUntil != null && row.agreementUntil > nowMs)) return next
  while (next.queue.length) {
    const beforeEvent = next
    const queued = next.queue[0]!
    const event = queued.event
    const sleeping = options.sleepers?.has(next.id) === true
    if (event.kind === 'note' && !sleeping
      && !roomNoteMayStart(event, { ...all, [next.id]: next }, nowMs, options.sleepers)) return next
    const queue = next.queue.slice(1)
    next = { ...next, lastActivityId: event.change_id }
    startedEvents.push(event)
    const detail = event.detail
    if (!sleeping && options.startAction && event.kind === 'action' && ['use', 'consume'].includes(String(detail.action))
      && (detail.status === 'applied' || detail.action === 'use' && detail.status === 'noop') && detail.error == null) {
      const consumed = { ...next, queue }
      const custom = options.startAction(consumed, event, { ...all, [next.id]: consumed }, nowMs)
      if (custom === null) { startedEvents.pop(); return beforeEvent }
      if (custom) return custom
    }
    const blocked = blockedAttemptFor(event)
    if (blocked) {
      next = { ...next, queue }
      if (next.placeId === null || !next.visible || !placeVisible(layout, next.placeId)) { addIssue(issues, 'blocked'); continue }
      return { ...next, blockedAttempt: Object.freeze({ attempt: blocked, expiresAt: nowMs + blockedAttemptDuration() }) }
    }
    if (event.kind === 'agreement_sign') {
      const signature = agreementSignature(event, agreementPairs)
      next = { ...next, queue }
      if (!signature) { addIssue(issues, 'agreement'); continue }
      agreementCandidates.push(Object.freeze({ signature, actorId: next.id }))
      return next
    }
    const invention = inventionFor(event)
    if (invention) {
      const expiresAt = nowMs + inventionDuration()
      startedInventions.push(Object.freeze({ invention, residentId: next.id, expiresAt }))
      return { ...next, queue, inventionUntil: expiresAt }
    }
    const transfer = transferFor(event)
    if (transfer) {
      next = { ...next, queue }
      candidates.push(Object.freeze({ transfer, changeId: event.change_id, actorId: next.id }))
      return next
    }
    if (event.kind === 'register') {
      next = arrive({ ...next, queue }, all, nowMs, layout, issues, reservations)
      if (next.sparkle) return next
      continue
    }
    const isApplied = event.kind === 'action' && (detail.action === 'move' || detail.action === 'go_home') && detail.status === 'applied' && !('error' in detail && detail.error != null)
    const isNoopAnchor = event.kind === 'action' && (detail.action === 'move' || detail.action === 'go_home') && detail.status === 'noop' &&
      validPlace(detail.from_place_id) && detail.from_place_id === detail.to_place_id
    const walk = isApplied ? appliedMove(event) : null
    if (walk && options.startMove) {
      const consumed = { ...next, queue }
      const custom = options.startMove(consumed, event, { ...all, [next.id]: consumed })
      // A busy doorway holds this recorded turn; it has not started or been drawn yet.
      if (custom === null) { startedEvents.pop(); return beforeEvent }
      if (custom) return custom
    }
    if (isNoopAnchor && next.placeId !== detail.from_place_id && layout.rooms[detail.from_place_id]) {
      const source = freeDestination(next.id, detail.from_place_id, all, layout, reservations)
      if (source) {
        // A first placement skips nothing; only a figure that already stood somewhere lost a route.
        if (next.placeId !== null) addIssue(issues, 'route-gap')
        next = { ...next, queue, placeId: detail.from_place_id, x: source.x, y: source.y, relocatedAt: nowMs, visible: placeVisible(layout, detail.from_place_id) }
        continue
      }
    }
    if (isApplied && validPlace(detail.from_place_id) && validPlace(detail.to_place_id)) {
      const fromId = detail.from_place_id
      const toId = detail.to_place_id
      if (!layout.rooms[fromId] || !layout.rooms[toId]) {
        addIssue(issues, 'room')
        next = { ...next, queue }
        continue
      }
      if (next.placeId === null) {
        const source = freeDestination(next.id, fromId, all, layout, reservations)
        if (!source) {
          addIssue(issues, 'placement')
          next = { ...next, queue }
          continue
        }
        next = { ...next, placeId: fromId, x: source.x, y: source.y, visible: placeVisible(layout, fromId) }
      }
      if (next.placeId !== fromId) {
        const source = freeDestination(next.id, fromId, all, layout, reservations)
        if (!source) {
          addIssue(issues, 'placement')
          next = { ...next, queue }
          continue
        }
        addIssue(issues, 'route-gap')
        next = { ...next, placeId: fromId, x: source.x, y: source.y, relocatedAt: nowMs, visible: placeVisible(layout, fromId) }
      }
      // A same-room applied move only anchors the figure; appliedMove says when there is a real walk.
      if (!walk) {
        next = { ...next, queue }
        continue
      }
      const destination = freeDestination(next.id, walk.toId, all, layout, reservations)
      if (!destination) {
        addIssue(issues, 'placement')
        next = { ...next, queue }
        continue
      }
      const directPath = walkPath(layout, walk.fromId, walk.toId, { x: next.x, y: next.y }, destination)
      const standing = Object.values(all)
        .filter(item => item.id !== next.id && !item.walking && item.placeId !== null)
        .map(item => ({ x: item.x, y: item.y }))
      const path = sidestepPath(layout, directPath, standing)
      if (path.length < 2) {
        addIssue(issues, 'route')
        next = { ...next, queue }
        continue
      }
      const distance = path.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - path[index]!.x, point.y - path[index]!.y), 0)
      return { ...next, queue, walking: true, path, walkElapsed: 0, walkDuration: distance / ROOM_WALK_SPEED * 1_000, destinationId: walk.toId, destination, bubble: null, walkEventId: event.change_id }
    }
    if (event.kind === 'note') {
      if (sleeping) {
        next = { ...next, queue }
        continue
      }
      next = handleNote(next, event, queue, all, nowMs, layout, issues, reservations)
      if (next.bubble || next.showingNotice) return next
      continue
    }
    next = { ...next, queue }
  }
  return next
}

function arrive(
  resident: ResidentState,
  all: Readonly<Record<number, ResidentState>>,
  nowMs: number,
  layout: NestedLayout,
  issues: string[],
  reservations: ThingReservations,
): ResidentState {
  if (resident.placeId !== null) return resident
  const root = layout.rooms[layout.rootId]
  if (!root) { addIssue(issues, 'room'); return resident }
  const occupied = Object.values(all).filter(item => item.id !== resident.id).flatMap(item => [
    ...(item.visible ? [{ x: item.x, y: item.y }] : []),
    ...(item.destinationId === root.id && item.destination ? [item.destination] : []),
    ...(!item.visible && !item.walking && item.placeId === root.id ? [{ x: item.x, y: item.y }] : []),
  ])
  const reserved = (reservations[root.id] ?? []).map(spot => ({ x: spot.x + 16, y: spot.y + 16 }))
  const point = newcomerSpot(resident.id, root, [...occupied, ...reserved])
  if (!point) { addIssue(issues, 'placement'); return resident }
  // The registration plus the city's front-door rule places a new resident in the
  // ownerless world. Only this free edge spot is presentation; later moves win.
  return { ...resident, placeId: root.id, x: point.x, y: point.y, visible: placeVisible(layout, root.id), sparkle: sparkleFor(nowMs) }
}

function handleNote(
  resident: ResidentState,
  event: ReplayEvent,
  queue: readonly QueuedEvent[],
  all: Readonly<Record<number, ResidentState>>,
  nowMs: number,
  layout: NestedLayout,
  issues: string[],
  reservations: ThingReservations,
): ResidentState {
  const recordedPlace = event.detail.place_id
  if (validPlace(recordedPlace) && !layout.rooms[recordedPlace]) {
    addIssue(issues, 'room')
    return { ...resident, queue }
  }
  const placeId = validPlace(recordedPlace) ? recordedPlace : resident.placeId
  let next = resident
  if (placeId !== null && resident.placeId !== placeId) {
    const destination = freeDestination(resident.id, placeId, all, layout, reservations)
    if (!destination) {
      addIssue(issues, 'placement')
      return { ...resident, queue }
    }
    if (resident.placeId !== null) addIssue(issues, 'route-gap')
    next = { ...resident, placeId, x: destination.x, y: destination.y, relocatedAt: nowMs, visible: placeVisible(layout, placeId) }
  }
  const bubble = bubbleFor({ ...event, detail: { ...event.detail, place_id: placeId ?? undefined } }, nowMs)
  const room = placeId === null ? undefined : layout.rooms[placeId]
  const showingNotice = !bubble && room ? showingNoticeFor(event, nowMs, [room]) : null
  return { ...next, queue, bubble, showingNotice }
}

function advanceWalk(resident: ResidentState, deltaMs: number, layout: NestedLayout): ResidentState {
  const walkElapsed = Math.min(resident.walkDuration, resident.walkElapsed + deltaMs)
  const elapsedShare = resident.walkDuration ? walkElapsed / resident.walkDuration : 1
  const sampled = pointAlongPath(resident.path, elapsedShare)
  if (!sampled.done) return { ...resident, walkElapsed, x: sampled.x, y: sampled.y, flipX: sampled.flipX, visible: visibleAt(sampled, layout) }
  const placeId = resident.destinationId
  return { ...resident, placeId, x: sampled.x, y: sampled.y, flipX: sampled.flipX, walking: false, visible: placeId !== null && placeVisible(layout, placeId), path: [], walkElapsed: 0, walkDuration: 0, destinationId: null, destination: null, walkEventId: null }
}

function freeDestination(id: number, placeId: number, all: Readonly<Record<number, ResidentState>>, layout: NestedLayout, reservations: ThingReservations): Point | null {
  const room = layout.rooms[placeId]
  if (!room) return null
  // A figure that is walking away has left; it holds a spot only in the room it walks to,
  // and holds it at its chosen destination, never at wherever this frame happened to draw it.
  const holds = (item: ResidentState): boolean => item.walking ? item.destinationId === placeId : item.placeId === placeId
  const eligible = Object.values(all).filter(item => item.id === id || holds(item))
  const previous: Record<string, StageStandingSpot> = {}
  for (const spot of reservations[placeId] ?? []) previous[spot.key] = spot
  const residentObstacles = eligible.flatMap(item => {
    const point = item.id === id ? null : item.walking ? item.destination : { x: item.x, y: item.y }
    return point ? [residentReservationFootprint(`resident:${String(item.id)}`, point)] : []
  })
  const entries = [
    ...(reservations[placeId] ?? []).map(spot => ({ key: spot.key, kind: 'thing' as const })),
    { key: `resident:${String(id)}`, kind: 'resident' as const },
  ]
  const spots = stageFindFreeSpots(entries, room.standing, previous, [], residentObstacles)
  const spot = spots[`resident:${String(id)}`]
  return spot ? Object.freeze({ x: spot.x + ROOM_RESIDENT_SIZE / 2, y: spot.y + ROOM_RESIDENT_SIZE / 2 }) : null
}

function placeStationary(residents: Record<number, ResidentState>, layout: NestedLayout, reservations: ThingReservations): void {
  for (const placeId of new Set(Object.values(residents).map(item => item.placeId).filter((id): id is number => id !== null))) {
    const room = layout.rooms[placeId]
    if (!room) continue
    const thingSpots = reservations[placeId] ?? []
    const entries = [
      ...thingSpots.map(spot => ({ key: spot.key, kind: 'thing' as const })),
      ...Object.values(residents).filter(item => item.placeId === placeId).map(item => ({ key: `resident:${String(item.id)}`, kind: 'resident' as const })),
    ]
    const previous = Object.fromEntries(thingSpots.map(spot => [spot.key, spot]))
    const spots = stageFindFreeSpots(entries, room.standing, previous)
    for (const item of Object.values(residents).filter(value => value.placeId === placeId)) {
      const spot = spots[`resident:${String(item.id)}`]
      if (spot) residents[item.id] = { ...item, x: spot.x + ROOM_RESIDENT_SIZE / 2, y: spot.y + ROOM_RESIDENT_SIZE / 2, visible: placeVisible(layout, placeId) }
    }
  }
}

function visibleAt(point: Point, layout: NestedLayout): boolean {
  const containing = Object.values(layout.rooms).filter(room => roomContains(room, point)).sort((a, b) => b.depth - a.depth)[0]
  return containing ? placeVisible(layout, containing.id) : true
}

function placeVisible(layout: NestedLayout, placeId: number): boolean {
  const visited = new Set<number>()
  let room = layout.rooms[placeId]
  while (room && !visited.has(room.id)) {
    if (room.quiet) return false
    visited.add(room.id)
    room = room.parentId === null ? undefined : layout.rooms[room.parentId]
  }
  return true
}

function baseResident(id: number, handle: string, placeId: number | null): ResidentState {
  return { id, handle, joinedAt: null, sparkle: null, placeId, x: 0, y: 0, flipX: false, walking: false, visible: false, bubble: null, queue: [], path: [], walkElapsed: 0, walkDuration: 0, destinationId: null, destination: null, walkEventId: null, transferUntil: null }
}

function isPending(resident: ResidentState): boolean {
  return resident.walking || resident.bubble !== null || resident.sparkle !== null || resident.showingNotice != null
    || resident.blockedAttempt != null || resident.transferUntil !== null || resident.inventionUntil != null || resident.agreementUntil != null || resident.actionUntil != null || resident.queue.length > 0
}

// Cards and queued notes never hold live delivery, regardless of whose card
// they wait for. Non-note work and active walks or effects must still finish.
export function blocksLiveDelivery(state: Simulation): boolean {
  return Object.values(state.residents).some(resident => resident.queue.some(queued => queued.event.kind !== 'note') || resident.walking || resident.sparkle !== null
    || resident.showingNotice != null || resident.blockedAttempt != null || resident.transferUntil !== null
    || resident.inventionUntil != null || resident.agreementUntil != null || resident.actionUntil != null)
}

function handshakeResident(row: ResidentState, drawn: boolean): HandshakeResident {
  return Object.freeze({ id: row.id, handle: row.handle, placeId: row.placeId, x: row.x, y: row.y, visible: row.visible && drawn,
    destinationId: row.destinationId, walking: row.walking,
    busy: Boolean(row.bubble || row.showingNotice || row.blockedAttempt || row.sparkle || row.transferUntil || row.inventionUntil || row.agreementUntil || row.actionUntil != null) })
}

function freezeSimulation(residents: Record<number, ResidentState>, actors: ReadonlyMap<string, number>, issues: readonly string[], pending: boolean, reservations: ThingReservations, startedTransfers: readonly StartedTransfer[]): Simulation {
  const frozen = Object.fromEntries(Object.entries(residents).map(([id, resident]) => [id, Object.freeze({ ...resident, queue: Object.freeze([...resident.queue]), path: Object.freeze([...resident.path]) })]))
  return Object.freeze({ residents: Object.freeze(frozen), actors: new Map(actors), pending, issues: Object.freeze([...issues]), reservations, startedTransfers: Object.freeze([...startedTransfers]) })
}

function validPlace(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

// One plain sentence per kind of trouble. It names no resident and gives no count,
// because the record did not give one; the city's own tabs hold the exact numbers.
const ISSUE_WORDS = {
  'route-gap': 'The record skips part of some routes; those figures reappear at their next recorded room.',
  actor: 'Some recorded events name residents the resident list does not know; they are not drawn.',
  registration: 'Some arrivals have no usable registration record; those figures wait for a recorded room.',
  room: 'Some recorded events name a room the map does not show; those are not drawn.',
  placement: 'Some rooms had no free spot left, so those figures were not moved into them.',
  route: 'Some recorded walks have no path on the map; those figures stay where the record last placed them.',
  handover: 'Some recorded handovers could not be shown because both residents were not visibly together.',
  agreement: 'Some recorded signatures could not be shown because the two original parties were not visibly together with a clear place to meet.',
  invention: 'Some recorded inventions could not be shown because their inventor has no visible place in the map.',
  blocked: 'Some recorded blocked attempts could not be shown because the resident had no visible place in the map.',
} as const

type IssueKind = keyof typeof ISSUE_WORDS

function addIssue(issues: string[], kind: IssueKind): void {
  const message = ISSUE_WORDS[kind]
  if (!issues.includes(message)) issues.push(message)
}
