import type { ReplayEvent } from './city/types.ts'
import type { NestedLayout, Point } from './ground/nested.ts'
import type { Simulation } from './replay/simulation.ts'
import {
  carriedMove,
  floatFrame,
  type CarriedMove,
  type Transfer,
  type TransferPartners,
} from './giving.ts'
import { BASE_SPEED } from './replay/index.ts'

export type CarryPlan = CarriedMove & Readonly<{
  noticeChangeId: string
  actionChangeId: string
}>
type HeldCarry = Readonly<{
  plan: CarryPlan
  rows: readonly ReplayEvent[]
  actionSeen: boolean
}>
type ActiveFloat = Readonly<{
  transfer: Transfer
  changeId: string
  partners: TransferPartners
  startedAt: number
  speed: number
}>
export type HandoverState = Readonly<{
  carries: readonly CarryPlan[]
  held: readonly HeldCarry[]
  floats: readonly ActiveFloat[]
  seenActions: readonly string[]
}>
export type HandoverMotion = Readonly<{
  key: string
  thingId: number
  x: number
  y: number
  visible: boolean
  heart?: Point
  alpha: number
}>
export type HandoverStep = Readonly<{
  state: HandoverState
  floorEvents: readonly ReplayEvent[]
  motions: readonly HandoverMotion[]
  carryThingIds: readonly number[]
  pending: boolean
}>

export function createHandovers(timeline: readonly ReplayEvent[]): HandoverState {
  const carries: CarryPlan[] = []
  for (let noticeIndex = 0; noticeIndex < timeline.length; noticeIndex += 1) {
    const notice = timeline[noticeIndex]!
    if (notice.kind !== 'thing_moved') continue
    for (let actionIndex = 0; actionIndex < timeline.length; actionIndex += 1) {
      const action = timeline[actionIndex]!
      const carry = carriedMove(action, notice)
      if (!carry) continue
      carries.push(Object.freeze({ ...carry, noticeChangeId: notice.change_id, actionChangeId: action.change_id }))
      break
    }
  }
  return freezeState(carries, [], [], [])
}

export function stepHandovers(
  state: HandoverState,
  due: readonly ReplayEvent[],
  simulation: Simulation,
  _layout: NestedLayout,
  nowMs: number,
  _speed: number = BASE_SPEED,
): HandoverStep {
  const residents = simulation.residents
  let held = state.held.map(item => ({ ...item, rows: [...item.rows] }))
  const seenActions = new Set(state.seenActions)
  const floorEvents: ReplayEvent[] = []
  const noticePlans = new Map(state.carries.map(plan => [plan.noticeChangeId, plan]))
  const actionPlans = new Map(state.carries.map(plan => [plan.actionChangeId, plan]))

  for (const event of due) {
    const noticePlan = noticePlans.get(event.change_id)
    if (noticePlan) {
      if (!held.some(item => item.plan.noticeChangeId === noticePlan.noticeChangeId)) {
        held.push({ plan: noticePlan, rows: [event], actionSeen: seenActions.has(noticePlan.actionChangeId) })
      }
      continue
    }
    const actionPlan = actionPlans.get(event.change_id)
    if (actionPlan) {
      seenActions.add(event.change_id)
      held = held.map(item => item.plan.noticeChangeId === actionPlan.noticeChangeId ? { ...item, actionSeen: true } : item)
      continue
    }
    const thingId = affectedThingId(event)
    const waiting = thingId === null ? undefined : [...held].reverse().find(item => item.plan.thingId === thingId)
    if (waiting) {
      held = held.map(item => item === waiting ? { ...item, rows: [...item.rows, event] } : item)
    } else {
      floorEvents.push(event)
    }
  }

  const motions: HandoverMotion[] = []
  const carryThingIds: number[] = []
  const remaining: typeof held = []
  let carryPending = false
  for (const item of held) {
    if (!item.actionSeen) { remaining.push(item); continue }
    const resident = residents[item.plan.carrierId]
    const queued = resident?.queue.some(entry => entry.event.change_id === item.plan.actionChangeId) === true
    const active = resident?.handle === item.plan.actor && resident.walking === true && resident.walkEventId === item.plan.actionChangeId
    if (active && resident) {
      carryPending = true
      carryThingIds.push(item.plan.thingId)
      motions.push(Object.freeze({ key: `carry:${item.plan.actionChangeId}`, thingId: item.plan.thingId, x: resident.x, y: resident.y - 12, visible: resident.visible, alpha: 1 }))
      remaining.push(item)
    } else if (queued) {
      carryPending = true
      remaining.push(item)
    } else {
      floorEvents.push(...item.rows)
    }
  }

  const floats: ActiveFloat[] = [...state.floats]
  for (const started of simulation.startedTransfers) {
    floats.push(Object.freeze({ transfer: started.transfer, changeId: started.changeId, partners: started.partners, startedAt: started.startedAt, speed: started.speed }))
  }
  const activeFloats: ActiveFloat[] = []
  for (const active of floats) {
    const frame = floatFrame(active.partners.from, active.partners.to, active.startedAt, nowMs, active.speed)
    if (!frame) continue
    activeFloats.push(active)
    motions.push(Object.freeze({
      key: `gift:${active.changeId}`,
      thingId: active.transfer.thingId,
      x: frame.x,
      y: frame.y,
      visible: true,
      heart: Object.freeze({ x: frame.heartX, y: frame.heartY }),
      alpha: frame.alpha,
    }))
  }

  const next = freezeState(state.carries, remaining, activeFloats, [...seenActions])
  return Object.freeze({
    state: next,
    floorEvents: Object.freeze(floorEvents),
    motions: Object.freeze(motions),
    carryThingIds: Object.freeze(carryThingIds),
    pending: carryPending || activeFloats.length > 0,
  })
}

function affectedThingId(event: ReplayEvent): number | null {
  const value = event.detail.thing_id ?? event.detail.source_thing_id
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function freezeState(carries: readonly CarryPlan[], held: readonly HeldCarry[], floats: readonly ActiveFloat[], seenActions: readonly string[]): HandoverState {
  return Object.freeze({ carries: Object.freeze([...carries]), held: Object.freeze([...held]), floats: Object.freeze([...floats]), seenActions: Object.freeze([...seenActions]) })
}
