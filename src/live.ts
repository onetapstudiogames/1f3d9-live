import type { ReplayEvent, ReplayFile, Resident } from './city/types.ts'
import type { AgreementPair } from './city/agreements.ts'
import type { NestedLayout } from './ground/nested.ts'
import { createHandovers, stepHandovers, type HandoverState } from './handovers.ts'
import { createThings, stepThings, type ThingSimulation } from './things.ts'
import { createResidents, stepResidents, type Simulation } from './replay/simulation.ts'
import { BASE_SPEED } from './replay/index.ts'

export type LiveReadState = Readonly<{
  marker: string
  seen: ReadonlySet<string>
  failures: number
  lastReadAt: number | null
  retryMs?: number
}>

const POLL_MS = 15_000
const MAX_RETRY_MS = 120_000

export function liveNoteReferences(events: readonly ReplayEvent[], layout: NestedLayout):
  readonly Readonly<{ event: ReplayEvent; index: number }>[] {
  return events.map((event, index) => ({ event, index })).filter(({ event }) => {
    const id = event.detail.note_id
    const placeId = event.detail.place_id
    if (event.kind !== 'note' || !Number.isSafeInteger(id) || (id as number) <= 0
      || typeof placeId !== 'number' || !layout.rooms[placeId]) return false
    let room: NestedLayout['rooms'][number] | undefined = layout.rooms[placeId]
    while (room) {
      if (room.quiet) return false
      room = room.parentId === null ? undefined : layout.rooms[room.parentId]
    }
    return true
  })
}

export function newLiveEvents(state: LiveReadState, events: readonly ReplayEvent[]): readonly ReplayEvent[] {
  const committed = numericId(state.marker)
  return [...events].filter(event => numericId(event.change_id) > committed && !state.seen.has(event.change_id))
    .sort((a, b) => numericId(a.change_id) - numericId(b.change_id))
}

export function liveReadSucceeded(
  state: LiveReadState, marker: string, events: readonly ReplayEvent[], readAt: number,
): LiveReadState {
  const seen = new Set(state.seen)
  for (const event of events) seen.add(event.change_id)
  return Object.freeze({ marker, seen, failures: 0, lastReadAt: readAt, retryMs: POLL_MS })
}

export function liveReadFailed(state: LiveReadState): LiveReadState {
  const failures = state.failures + 1
  return Object.freeze({ ...state, failures, retryMs: Math.min(MAX_RETRY_MS, POLL_MS * 2 ** failures) })
}

export function validContinuation(current: string, next: string, hasMore: boolean): boolean {
  const before = numericId(current)
  const after = numericId(next)
  return after >= before && (!hasMore || after > before)
}

function numericId(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

export type SettledCity = Readonly<{ residents: Simulation; things: ThingSimulation; handovers: HandoverState; elapsed: number }>

export function settleAtNow(
  replay: ReplayFile, census: readonly Resident[], layout: NestedLayout, speed: number = BASE_SPEED,
  agreementPairs: ReadonlyMap<string, AgreementPair> = new Map(),
): SettledCity {
  let things = createThings(replay, layout)
  let residents = createResidents(replay, census, layout, things.reservations)
  let handovers = createHandovers(replay.timeline)
  let elapsed = 0
  const settleStep = 1_000_000
  for (const event of replay.timeline) {
    let incoming: readonly ReplayEvent[] = [event]
    for (let frame = 0; frame < 100_000; frame += 1) {
      elapsed += settleStep
      residents = stepResidents(residents, incoming, settleStep, elapsed, layout, speed, agreementPairs)
      const handover = stepHandovers(handovers, incoming, residents, layout, elapsed, speed)
      handovers = handover.state
      things = stepThings(things, handover.floorEvents, elapsed, speed)
      incoming = []
      if (!residents.pending && !things.pending && !handover.pending) break
      if (frame === 99_999) throw new Error('A recorded moment did not settle into the current state.')
    }
  }
  const current = currentCensusResidents(replay, census, layout, things.reservations, residents)
  residents = Object.freeze({ ...current, issues: residents.issues, reservations: things.reservations })
  return Object.freeze({ residents, things, handovers, elapsed })
}

function currentCensusResidents(
  replay: ReplayFile, census: readonly Resident[], layout: NestedLayout, reservations: ThingSimulation['reservations'], settled: Simulation,
): Simulation {
  const starts = { ...replay.start }
  for (const resident of Object.values(settled.residents)) starts[`resident:${resident.id}`] = { place_id: resident.placeId }
  for (const resident of census) starts[`resident:${resident.id}`] = { place_id: resident.current_place_id }
  const registrations = replay.timeline.filter(event => event.kind === 'register')
  return createResidents({ ...replay, start: starts, timeline: registrations }, census, layout, reservations)
}
