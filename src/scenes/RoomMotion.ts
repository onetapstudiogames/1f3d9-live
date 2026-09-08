import type { ReplayEvent } from '../city/types.ts'
import type { NestedLayout, Point, Room } from '../ground/nested.ts'
import { singleRoomLayout, projectRoomPoint, roomViewportUsable } from '../room-view.ts'
import type { ResidentState } from '../replay/simulation.ts'
import {
  arrivalSpot,
  createDeparture,
  createIdleDrift,
  createRoomWalk,
  idleDriftDueAt,
  sampleIdleDrift,
  sampleRoomWalk,
  motionSegmentClear,
  ROOM_WALK_SPEED,
  roomMovesConflict,
  type MotionRect,
  type RoomWalkPlan,
} from '../room-motion.ts'
import { ROOM_RESIDENT_SIZE } from '../room-appearance.ts'
import { roomIsPublic } from '../room-view.ts'
import { ROOM_FIGURE_PITCH } from '../room-crowding.ts'
import { presentRoom } from '../room-presentation.ts'
import { resizeRoomWalk } from '../room-walk-resize.ts'

export type RoomMotionPose = Readonly<{
  x: number
  y: number
  placeId: number
  visible: boolean
  moving: boolean
  flipX?: boolean
}>

export type RoomMotionPresentation = Readonly<{
  poses: ReadonlyMap<number, RoomMotionPose>
  reservations: readonly MotionRect[]
  routes: readonly Readonly<{ points: readonly Point[]; radius: number }>[]
}>

type PresentedEntity = Readonly<{ id: number; placeId: number | null; x: number; y: number; visible: boolean }>
type Viewport = Readonly<{ width: number; height: number }>
type ActiveWalk = {
  plan: RoomWalkPlan
  elapsedMs: number
  targetWorld: Point
  viewport: Viewport
  hideOnDone?: boolean
  unshowable?: boolean
}
export type RoomMotionDiagnostic = Readonly<{
  id: number
  x: number
  y: number
  placeId: number
  phase: 'departure' | 'arrival' | 'done'
  walking: boolean
  speed: number
  door: Point
  path: readonly Point[]
}>

/** Owns CSS-room motion only. Recorded world coordinates remain on ResidentState. */
export class RoomMotion {
  private layout?: NestedLayout
  private viewport: Viewport = { width: 0, height: 0 }
  private selectedRoomId: number | null = null
  private following: number | null = null
  private hidden: ReadonlySet<number> = new Set()
  private suppressedMoveIds: ReadonlySet<string> = new Set()
  private things: Readonly<Record<number, PresentedEntity>> = {}
  private rememberedThings = new Map<number, RoomMotionPose>()
  private unseated = new Set<string>()
  private remembered = new Map<number, RoomMotionPose>()
  private walks = new Map<number, ActiveWalk>()
  private diagnosticFrames = new Map<number, RoomMotionDiagnostic>()
  private idleWalks = new Map<number, Readonly<{ plan: NonNullable<ReturnType<typeof createIdleDrift>>;
    elapsedMs: number; roomId: number }>>()
  private idleDue = new Map<number, number>()
  private lastResidents: Readonly<Record<number, ResidentState>> = {}
  private summaries = new Map<number, Readonly<{ roomId: number; occupants: string }>>()

  configure(
    layout: NestedLayout,
    things: Readonly<Record<number, PresentedEntity>>,
    viewport: Viewport,
    selectedRoomId: number | null,
    following: number | null,
    hidden: ReadonlySet<number>,
    suppressedMoveIds: ReadonlySet<string>,
  ): void {
    const priorSelectedRoomId = this.selectedRoomId
    const resized = viewport.width !== this.viewport.width || viewport.height !== this.viewport.height
    this.layout = layout; this.things = things; this.viewport = Object.freeze({ ...viewport })
    this.selectedRoomId = selectedRoomId; this.following = following
    this.hidden = hidden; this.suppressedMoveIds = suppressedMoveIds
    if (priorSelectedRoomId !== selectedRoomId) this.cancelIdle()
    if (resized) {
      this.idleWalks.clear(); this.diagnosticFrames.clear()
      for (const id of [...this.remembered.keys()]) if (!this.walks.has(id)) this.remembered.delete(id)
      this.rememberedThings.clear()
      this.summaries.clear()
      if (roomViewportUsable(viewport.width, viewport.height)) {
        for (const [id, active] of this.walks) {
          const sourceWorld = active.plan.fromId === null ? undefined : layout.rooms[active.plan.fromId]
          const targetWorldRoom = layout.rooms[active.plan.toId]!
          const targetRoom = displayRoom(targetWorldRoom, viewport)
          const sourceRoom = sourceWorld ? displayRoom(sourceWorld, viewport) : undefined
          const occupants = Object.fromEntries(Object.entries(this.lastResidents).filter(([key]) => Number(key) !== id))
          this.primeRoom(active.plan.toId, occupants, true)
          if (sourceRoom) this.primeRoom(sourceRoom.id, occupants, true)
          const targetObstacles = this.obstacles(active.plan.toId, targetRoom, this.lastResidents, id)
          const sourceObstacles = sourceRoom ? this.obstacles(sourceRoom.id, sourceRoom, this.lastResidents, id) : []
          const preferred = projectRoomPoint(active.targetWorld, targetWorldRoom, targetRoom)!
          const target = active.hideOnDone ? preferred : arrivalSpot(targetRoom, preferred, targetObstacles)
          const plan = target && resizeRoomWalk(active.plan, active.elapsedMs,
            sourceWorld ? displayRoom(sourceWorld, active.viewport) : undefined, sourceRoom,
            displayRoom(targetWorldRoom, active.viewport), targetRoom, target, sourceObstacles, targetObstacles)
          if (plan && target) {
            active.plan = plan; active.elapsedMs = 0; active.viewport = Object.freeze({ ...viewport }); active.unshowable = false
            active.targetWorld = projectRoomPoint(target, targetRoom, targetWorldRoom)!
            this.remembered.set(id, pose(sampleRoomWalk(plan, 0), true))
          } else active.unshowable = true
        }
      }
    }
  }

  remember(
    residents: Readonly<Record<number, PresentedEntity>>,
    things: Readonly<Record<number, PresentedEntity>>,
  ): void {
    const active = new Set([...this.walks.keys(), ...this.idleWalks.keys()])
    for (const row of Object.values(residents)) {
      if (active.has(row.id) || row.placeId === null) continue
      if (!row.visible) continue
      this.summaries.delete(row.id)
      this.remembered.set(row.id, Object.freeze({ x: row.x, y: row.y, placeId: row.placeId,
        visible: true, moving: false }))
    }
    for (const row of Object.values(things)) {
      if (row.placeId === null || !row.visible) continue
      this.rememberedThings.set(row.id, Object.freeze({ x: row.x, y: row.y, placeId: row.placeId,
        visible: true, moving: false }))
    }
  }

  start(
    resident: ResidentState,
    event: ReplayEvent,
    all: Readonly<Record<number, ResidentState>>,
  ): ResidentState | null | undefined {
    this.lastResidents = all
    const move = recordedMove(event)
    if (!move || !this.layout?.rooms[move.fromId] || !this.layout.rooms[move.toId]) return undefined
    if (this.suppressedMoveIds.has(event.change_id)) {
      this.walks.delete(resident.id); this.remembered.delete(resident.id)
      return resident
    }
    if ([...this.walks.values()].some(active => roomMovesConflict(move, active.plan))) return null
    this.cancelIdle()
    const relevant = this.selectedRoomId === move.fromId || this.selectedRoomId === move.toId || this.following === resident.id
    if (!relevant || this.hidden.has(move.fromId) || this.hidden.has(move.toId) ||
        !roomViewportUsable(this.viewport.width, this.viewport.height)) {
      this.walks.delete(resident.id); this.remembered.delete(resident.id)
      return finishResident(resident, event.change_id, move.toId,
        worldStandingPoint(this.layout.rooms[move.toId]!), roomIsPublic(this.layout, move.toId) && !this.hidden.has(move.toId))
    }
    const sourceVisible = this.selectedRoomId === move.fromId || this.following === resident.id
    const source = displayRoom(this.layout.rooms[move.fromId]!, this.viewport)
    const target = displayRoom(this.layout.rooms[move.toId]!, this.viewport)
    this.primeRoom(move.fromId, all)
    this.primeRoom(move.toId, all)
    const cachedOrigin = this.remembered.get(resident.id)
    const origin = !sourceVisible ? null : cachedOrigin?.placeId === move.fromId ? cachedOrigin :
      projectedResident(resident, this.layout.rooms[move.fromId]!, source)
    if (sourceVisible && !origin) return this.finishHidden(resident, event.change_id, move.toId)
    const sourceObstacles = [...this.obstacles(move.fromId, source, all, resident.id),
      ...this.routeReservations(move.fromId, resident.id)]
    const targetObstacles = [...this.obstacles(move.toId, target, all, resident.id),
      ...this.routeReservations(move.toId, resident.id)]
    const preferredWorld = worldStandingPoint(this.layout.rooms[move.toId]!)
    const preferred = projectRoomPoint(preferredWorld, this.layout.rooms[move.toId]!, target)!
    const targetPoint = arrivalSpot(target, preferred, targetObstacles)
    let plan = targetPoint && createRoomWalk(sourceVisible ? source : undefined, target, origin ?? targetPoint,
      targetPoint, sourceObstacles, targetObstacles)
    let hideOnDone = false
    if (!plan && sourceVisible && origin) {
      const departure = createDeparture(source, origin, sourceObstacles)
      if (departure) { plan = departureOnlyPlan(move.fromId, move.toId, departure); hideOnDone = true }
    }
    if (!plan) {
      return this.finishHidden(resident, event.change_id, move.toId, preferredWorld)
    }
    const targetWorld = targetPoint ? projectRoomPoint(targetPoint, target, this.layout.rooms[move.toId]!) ?? preferredWorld : preferredWorld
    this.walks.set(resident.id, { plan, elapsedMs: 0, targetWorld, viewport: Object.freeze({ ...this.viewport }), hideOnDone })
    const sample = sampleRoomWalk(plan, 0)
    this.remembered.set(resident.id, pose(sample, true))
    this.setDiagnostic(resident.id, plan, sample)
    const arrivingOnly = plan.fromId === null
    return Object.freeze({ ...resident, placeId: arrivingOnly ? move.toId : resident.placeId,
      x: arrivingOnly ? targetWorld.x : resident.x, y: arrivingOnly ? targetWorld.y : resident.y,
      walking: true, ambientWalking: false, walkEventId: event.change_id,
      destinationId: move.toId, destination: targetWorld, path: [], walkElapsed: 0,
      walkDuration: plan.durationMs, walkSpeed: undefined, bubble: null })
  }

  advance(resident: ResidentState, deltaMs: number): ResidentState | undefined {
    const active = this.walks.get(resident.id)
    if (!active) return undefined
    if (!roomViewportUsable(this.viewport.width, this.viewport.height)) return resident
    if (active.unshowable) return this.finishHidden(resident, resident.walkEventId ?? '', active.plan.toId, active.targetWorld)
    active.elapsedMs = Math.min(active.plan.durationMs, active.elapsedMs + Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0))
    const sample = sampleRoomWalk(active.plan, active.elapsedMs)
    this.remembered.set(resident.id, pose(sample, !sample.done))
    this.setDiagnostic(resident.id, active.plan, sample)
    if (sample.done) {
      this.walks.delete(resident.id)
      if (active.hideOnDone) return this.finishHidden(resident, resident.walkEventId ?? '', active.plan.toId, active.targetWorld)
      return finishResident(resident, resident.walkEventId, active.plan.toId, active.targetWorld, true)
    }
    const entered = sample.phase !== 'departure'
    return Object.freeze({ ...resident, placeId: entered ? active.plan.toId : resident.placeId,
      x: entered ? active.targetWorld.x : resident.x, y: entered ? active.targetWorld.y : resident.y,
      visible: true, flipX: sample.flipX, walking: true, walkElapsed: active.elapsedMs })
  }

  presentation(roomId: number | null): RoomMotionPresentation {
    const poses = new Map<number, RoomMotionPose>()
    const reservations: MotionRect[] = []
    const routes: Array<Readonly<{ points: readonly Point[]; radius: number }>> = []
    const reservationHalf = ROOM_FIGURE_PITCH / 2
    for (const [id, value] of this.remembered) {
      if (value.placeId !== roomId) continue
      poses.set(id, value)
      if (value.moving) reservations.push(Object.freeze({ x: value.x - reservationHalf, y: value.y - reservationHalf,
        width: ROOM_FIGURE_PITCH, height: ROOM_FIGURE_PITCH }))
    }
    for (const active of this.walks.values()) {
      if (active.plan.fromId === roomId) routes.push(Object.freeze({ points: active.plan.departure, radius: reservationHalf }))
      if (active.plan.toId === roomId) routes.push(Object.freeze({ points: active.plan.arrival, radius: reservationHalf }))
    }
    for (const active of this.idleWalks.values()) if (active.roomId === roomId) routes.push(Object.freeze({
      points: Object.freeze([active.plan.from, active.plan.to]), radius: reservationHalf }))
    return Object.freeze({ poses, reservations: Object.freeze(reservations), routes: Object.freeze(routes) })
  }

  idle(all: Readonly<Record<number, ResidentState>>, deltaMs: number, nowMs: number,
    sleepers: ReadonlySet<number>): void {
    this.lastResidents = all
    for (const [id, summary] of this.summaries) {
      if (all[id]?.bubble || summary.occupants !== this.occupantsKey(summary.roomId, all)) {
        this.remembered.delete(id); this.summaries.delete(id)
      }
    }
    if (!this.layout || this.selectedRoomId === null || this.hidden.has(this.selectedRoomId) ||
        !this.layout.rooms[this.selectedRoomId] || !roomViewportUsable(this.viewport.width, this.viewport.height)) {
      this.cancelIdle(); return
    }
    const room = displayRoom(this.layout.rooms[this.selectedRoomId]!, this.viewport)
    const elapsed = Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0)
    for (const id of [...this.idleWalks.keys()].sort((a, b) => a - b)) {
      const active = this.idleWalks.get(id)!; const nextElapsed = active.elapsedMs + elapsed
      const sample = sampleIdleDrift(active.plan, nextElapsed)
      const current = this.remembered.get(id)
      if (!current || !all[id] || residentBusy(all[id]!) || sleepers.has(id)) {
        this.cancelOneIdle(id); this.idleDue.set(id, idleDriftDueAt(id, nowMs)); continue
      }
      const occupied = this.obstacles(this.selectedRoomId, room, all, id)
      if (!motionSegmentClear({ x: sample.x, y: sample.y }, active.plan.to, occupied)) {
        this.cancelOneIdle(id); this.idleDue.set(id, idleDriftDueAt(id, nowMs)); continue
      }
      this.remembered.set(id, Object.freeze({ ...current, x: sample.x, y: sample.y,
        moving: !sample.done, flipX: sample.flipX }))
      if (sample.done) { this.idleWalks.delete(id); this.idleDue.set(id, idleDriftDueAt(id, nowMs)) }
      else this.idleWalks.set(id, Object.freeze({ plan: active.plan, elapsedMs: nextElapsed, roomId: active.roomId }))
    }
    for (const resident of Object.values(all).sort((a, b) => a.id - b.id)) {
      if (this.idleWalks.has(resident.id) || resident.placeId !== this.selectedRoomId || residentBusy(resident) ||
          sleepers.has(resident.id) || !resident.visible) continue
      const origin = this.remembered.get(resident.id)
      if (!origin?.visible || origin.placeId !== this.selectedRoomId) continue
      const due = this.idleDue.get(resident.id) ?? idleDriftDueAt(resident.id, nowMs)
      if (!this.idleDue.has(resident.id)) this.idleDue.set(resident.id, due)
      if (nowMs < due) continue
      const obstacles = [...this.obstacles(this.selectedRoomId, room, all, resident.id),
        ...this.routeReservations(this.selectedRoomId, resident.id)]
      const plan = createIdleDrift(resident.id, Math.floor(due / 1_000), room, origin, obstacles)
      if (!plan) { this.idleDue.set(resident.id, idleDriftDueAt(resident.id, nowMs)); continue }
      this.idleDue.delete(resident.id); this.idleWalks.set(resident.id,
        Object.freeze({ plan, elapsedMs: 0, roomId: this.selectedRoomId }))
      this.remembered.set(resident.id, Object.freeze({ ...origin, moving: true, flipX: plan.to.x < plan.from.x }))
    }
  }

  diagnostics(): readonly RoomMotionDiagnostic[] {
    return Object.freeze([...this.diagnosticFrames.values()].sort((left, right) => left.id - right.id))
  }

  private setDiagnostic(id: number, plan: RoomWalkPlan, sample: ReturnType<typeof sampleRoomWalk>): void {
    const source = plan.fromId === null ? undefined : this.layout?.rooms[plan.fromId]
    const target = this.layout?.rooms[plan.toId]
    const sourceDisplay = source ? displayRoom(source, this.viewport) : undefined
    const targetDisplay = target ? displayRoom(target, this.viewport) : undefined
    const departure = sample.phase === 'departure'
    const path = departure ? plan.departure : plan.arrival
    const door = departure ? sourceDisplay?.door : targetDisplay?.door
    if (!door) return
    this.diagnosticFrames.set(id, Object.freeze({ id, x: sample.x, y: sample.y, placeId: sample.roomId,
      phase: sample.phase, walking: !sample.done, speed: ROOM_WALK_SPEED, door: Object.freeze({ ...door }), path }))
  }

  private obstacles(roomId: number, display: Room,
    residents: Readonly<Record<number, ResidentState>>, excludedId: number): readonly MotionRect[] {
    if (!this.layout) return Object.freeze([])
    const source = this.layout.rooms[roomId]!
    const residentRects = Object.values(residents).flatMap(row => {
      if (row.id === excludedId || row.placeId !== roomId || !row.visible) return []
      if (this.unseated.has(`resident:${roomId}:${row.id}`)) return []
      const cached = this.remembered.get(row.id)
      const point = cached?.placeId === roomId ? cached : projectedResident(row, source, display)
      const half = ROOM_RESIDENT_SIZE / 2
      return point ? [{ x: point.x - half, y: point.y - half,
        width: ROOM_RESIDENT_SIZE, height: ROOM_RESIDENT_SIZE }] : []
    })
    const thingRects = Object.values(this.things).flatMap(row => {
      if (row.placeId !== roomId || !row.visible) return []
      if (this.unseated.has(`thing:${roomId}:${row.id}`)) return []
      const cached = this.rememberedThings.get(row.id)
      const point = cached?.placeId === roomId ? cached : projectRoomPoint(row, source, display)
      return point ? [{ x: point.x - 16, y: point.y - 16, width: 32, height: 32 }] : []
    })
    return Object.freeze([...residentRects, ...thingRects].map(rect => Object.freeze(rect)))
  }

  private primeRoom(roomId: number, residents: Readonly<Record<number, ResidentState>>, resized = false): void {
    if (!this.layout || !this.layout.rooms[roomId] || !roomViewportUsable(this.viewport.width, this.viewport.height)) return
    const target = singleRoomLayout(this.layout.rooms[roomId]!, this.viewport.width, this.viewport.height)
    const hidden = new Set(Object.keys(this.layout.rooms).map(Number).filter(id => id !== roomId || this.hidden.has(id)))
    const motion = resized ? { poses: new Map(), reservations: [] } : this.presentation(roomId)
    const frame = presentRoom(residents, this.things, this.layout, target, hidden, {}, this.following, new Map(),
      motion)
    for (const row of Object.values(residents)) if (row.placeId === roomId) {
      this.unseated.add(`resident:${roomId}:${row.id}`)
    }
    for (const row of Object.values(frame.residents)) {
      if (row.placeId !== roomId || !row.visible || this.walks.has(row.id) || this.idleWalks.has(row.id)) continue
      this.unseated.delete(`resident:${roomId}:${row.id}`)
      this.remembered.set(row.id, Object.freeze({ x: row.x, y: row.y, placeId: roomId, visible: true, moving: false }))
    }
    for (const row of Object.values(this.things)) if (row.placeId === roomId) this.unseated.add(`thing:${roomId}:${row.id}`)
    for (const row of Object.values(frame.things)) if (row.placeId === roomId && row.visible) {
      this.unseated.delete(`thing:${roomId}:${row.id}`)
      this.rememberedThings.set(row.id, Object.freeze({ x: row.x, y: row.y, placeId: roomId, visible: true, moving: false }))
    }
  }

  private routeReservations(roomId: number | null, excludedId?: number): readonly MotionRect[] {
    if (roomId === null) return Object.freeze([])
    const result: MotionRect[] = []
    for (const [id, active] of this.walks) {
      if (id === excludedId) continue
      if (active.plan.fromId === roomId) result.push(...sweptRects(active.plan.departure))
      if (active.plan.toId === roomId) result.push(...sweptRects(active.plan.arrival))
    }
    for (const [id, active] of this.idleWalks) if (id !== excludedId && active.roomId === roomId) {
      result.push(...sweptRects([active.plan.from, active.plan.to]))
    }
    return Object.freeze(result)
  }

  private finishHidden(resident: ResidentState, eventId: string, placeId: number,
    target: Point = worldStandingPoint(this.layout!.rooms[placeId]!)): ResidentState {
    this.walks.delete(resident.id)
    const point = roomViewportUsable(this.viewport.width, this.viewport.height)
      ? projectRoomPoint(target, this.layout!.rooms[placeId]!, displayRoom(this.layout!.rooms[placeId]!, this.viewport)) ?? target : target
    this.remembered.set(resident.id, Object.freeze({ ...point, placeId,
      visible: false, moving: false }))
    const finished = finishResident(resident, eventId, placeId, target,
      Boolean(this.layout && roomIsPublic(this.layout, placeId) && !this.hidden.has(placeId)))
    this.summaries.set(resident.id, Object.freeze({ roomId: placeId,
      occupants: this.occupantsKey(placeId, { ...this.lastResidents, [resident.id]: finished }) }))
    return finished
  }

  private occupantsKey(placeId: number, residents: Readonly<Record<number, ResidentState>>): string {
    return JSON.stringify([
      Object.values(residents).filter(row => row.placeId === placeId).map(row => row.id).sort((a, b) => a - b),
      Object.values(this.things).filter(row => row.placeId === placeId && row.visible).map(row => row.id).sort((a, b) => a - b),
    ])
  }

  private cancelOneIdle(id: number): void {
    this.idleWalks.delete(id)
    const pose = this.remembered.get(id)
    if (pose) this.remembered.set(id, Object.freeze({ ...pose, moving: false }))
  }

  private cancelIdle(): void {
    for (const id of this.idleWalks.keys()) this.cancelOneIdle(id)
  }
}

function recordedMove(event: ReplayEvent): Readonly<{ fromId: number; toId: number }> | null {
  const detail = event.detail
  return event.kind === 'action' && (detail.action === 'move' || detail.action === 'go_home') &&
    detail.status === 'applied' && detail.error == null && Number.isSafeInteger(detail.from_place_id) &&
    Number.isSafeInteger(detail.to_place_id) && detail.from_place_id !== detail.to_place_id
    ? Object.freeze({ fromId: detail.from_place_id!, toId: detail.to_place_id! }) : null
}

function displayRoom(source: Room, viewport: Viewport): Room {
  return singleRoomLayout(source, viewport.width, viewport.height).rooms[source.id]!
}

function projectedResident(row: PresentedEntity, source: Room, target: Room): RoomMotionPose | null {
  const point = projectRoomPoint(row, source, target)
  return point ? Object.freeze({ ...point, placeId: source.id, visible: row.visible, moving: false }) : null
}

function worldStandingPoint(room: Room): Point {
  return Object.freeze({ x: room.standing.x + room.standing.width / 2,
    y: room.standing.y + room.standing.height / 2 })
}

function pose(sample: ReturnType<typeof sampleRoomWalk>, moving: boolean): RoomMotionPose {
  return Object.freeze({ x: sample.x, y: sample.y, placeId: sample.roomId, visible: true, moving })
}

function finishResident(resident: ResidentState, eventId: string | null, placeId: number,
  target: Point, keepVisible: boolean): ResidentState {
  return Object.freeze({ ...resident, placeId, x: target.x, y: target.y, visible: keepVisible,
    walking: false, path: [], walkElapsed: 0, walkDuration: 0, walkSpeed: undefined,
    destinationId: null, destination: null, walkEventId: null,
    lastActivityId: eventId ?? resident.lastActivityId })
}

function residentBusy(resident: ResidentState): boolean {
  return resident.walking || resident.queue.length > 0 || resident.bubble !== null || resident.sparkle !== null ||
    resident.transferUntil !== null || resident.inventionUntil != null || resident.agreementUntil != null ||
    resident.showingNotice != null || resident.blockedAttempt != null
}

function departureOnlyPlan(fromId: number, toId: number, departure: readonly Point[]): RoomWalkPlan {
  const distance = pathLength(departure)
  return Object.freeze({ fromId, toId, departure, arrival: Object.freeze([]), departureDistance: distance,
    arrivalDistance: 0, distance, durationMs: distance / ROOM_WALK_SPEED * 1_000 })
}

function sweptRects(path: readonly Point[]): readonly MotionRect[] {
  const half = ROOM_FIGURE_PITCH / 2
  const result: MotionRect[] = []
  for (const [index, to] of path.slice(1).entries()) {
    const from = path[index]!
    const distance = Math.hypot(to.x - from.x, to.y - from.y)
    const steps = Math.max(1, Math.ceil(distance / 4))
    for (let step = 0; step <= steps; step += 1) {
      const share = step / steps
      const x = from.x + (to.x - from.x) * share; const y = from.y + (to.y - from.y) * share
      result.push(Object.freeze({ x: x - half, y: y - half,
        width: ROOM_FIGURE_PITCH, height: ROOM_FIGURE_PITCH }))
    }
  }
  return Object.freeze(result)
}

function pathLength(path: readonly Point[]): number {
  return path.slice(1).reduce((sum, point, index) => sum +
    Math.hypot(point.x - path[index]!.x, point.y - path[index]!.y), 0)
}
