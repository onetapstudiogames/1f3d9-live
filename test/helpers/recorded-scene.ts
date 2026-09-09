import type { ReplayEvent, ReplayFile, Resident } from '../../src/city/types.ts'
import type { AgreementPair } from '../../src/city/agreements.ts'
import { initialResidents, residentIndex } from '../../src/city/residents.ts'
import type { NestedLayout } from '../../src/ground/nested.ts'
import { createHandovers, stepHandovers, type HandoverState } from '../../src/handovers.ts'
import { registrationFor } from '../../src/newcomers.ts'
import { createdThing, createThings, movedThing, stepThings, type ThingSimulation } from '../../src/things.ts'
import { createResidents, stepResidents, type Simulation } from '../../src/replay/simulation.ts'

export type SceneClock = Readonly<{ time: number; start: number; end: number }>
export type SceneTimelineRow = Readonly<{ event: ReplayEvent; time: number }>

export function createSceneClock(start: string, end: string): SceneClock {
  const startTime = Date.parse(start)
  const endTime = Date.parse(end)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    throw new RangeError('Recorded scene window must contain valid dates in chronological order')
  }
  return { time: startTime, start: startTime, end: endTime }
}

export function advanceSceneClock(clock: SceneClock, deltaMs: number): SceneClock {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return clock
  return { ...clock, time: Math.min(clock.end, clock.time + deltaMs) }
}

export function prepareSceneTimeline(timeline: readonly ReplayEvent[]): readonly SceneTimelineRow[] {
  const rows = timeline
    .map((event, originalIndex) => ({ event, originalIndex,
      time: Number.isFinite(Date.parse(event.at)) ? Date.parse(event.at) : Number.POSITIVE_INFINITY }))
    .sort((left, right) => left.time - right.time || left.originalIndex - right.originalIndex)
    .map(({ event, time }) => Object.freeze({ event, time }))
  return Object.freeze(rows)
}

export function dueSceneEvents(
  timeline: readonly SceneTimelineRow[], cursor: number, time: number,
): { events: readonly ReplayEvent[]; cursor: number } {
  const safeCursor = Math.min(timeline.length, Math.max(0, Math.floor(Number.isFinite(cursor) ? cursor : 0)))
  if (!Number.isFinite(time)) return { events: [], cursor: safeCursor }
  let nextCursor = safeCursor
  while (nextCursor < timeline.length && timeline[nextCursor]!.time <= time) nextCursor += 1
  return { events: timeline.slice(safeCursor, nextCursor).map(({ event }) => event), cursor: nextCursor }
}

export type SettledScene = Readonly<{
  residents: Simulation; things: ThingSimulation; handovers: HandoverState; elapsed: number
}>

export function settleRecordedScene(
  replay: ReplayFile, census: readonly Resident[], layout: NestedLayout,
  agreementPairs: ReadonlyMap<string, AgreementPair> = new Map(),
): SettledScene {
  let things = createThings(replay, layout)
  let residents = createResidents(replay, census, layout, things.reservations)
  let handovers = createHandovers(replay.timeline)
  let elapsed = 0
  const settleStep = 1_000_000
  for (const event of replay.timeline) {
    let incoming: readonly ReplayEvent[] = [event]
    for (let frame = 0; frame < 100_000; frame += 1) {
      elapsed += settleStep
      residents = stepResidents(residents, incoming, settleStep, elapsed, layout, agreementPairs)
      const handover = stepHandovers(handovers, incoming, residents, layout, elapsed)
      handovers = handover.state
      things = stepThings(things, handover.floorEvents, elapsed)
      incoming = []
      if (!residents.pending && !things.pending && !handover.pending) break
      if (frame === 99_999) throw new Error('A recorded moment did not settle into the current state.')
    }
  }
  const starts = { ...replay.start }
  for (const resident of Object.values(residents.residents)) starts[`resident:${resident.id}`] = { place_id: resident.placeId }
  for (const resident of census) starts[`resident:${resident.id}`] = { place_id: resident.current_place_id }
  const registrations = replay.timeline.filter(event => event.kind === 'register')
  const current = createResidents({ ...replay, start: starts, timeline: registrations }, census, layout, things.reservations)
  residents = Object.freeze({ ...current, issues: residents.issues, reservations: things.reservations })
  return Object.freeze({ residents, things, handovers, elapsed })
}

export function recordedRoomCapacity(replay: ReplayFile, census: readonly Resident[]): Readonly<Record<number, number>> {
  const handles = residentIndex(census)
  const registrations = new Map(replay.timeline.flatMap(event => {
    const registration = registrationFor(event)
    return registration ? [[registration.handle, registration.id] as const] : []
  }))
  const rootId = replay.map.places.find(place => place.parent_id === null)?.id
  const occupants = new Map<number, Set<string>>()
  const add = (placeId: unknown, key: string | undefined): void => {
    if (typeof placeId !== 'number' || !Number.isInteger(placeId) || placeId <= 0 || key === undefined) return
    const held = occupants.get(placeId) ?? new Set<string>()
    held.add(key); occupants.set(placeId, held)
  }
  for (const resident of initialResidents(replay, census)) add(resident.placeId, `id:${String(resident.id)}`)
  for (const [key, start] of Object.entries(replay.start)) {
    if (/^thing:(\d+)$/.test(key)) add(start?.place_id, key)
  }
  for (const event of replay.timeline) {
    const thing = createdThing(event) ?? movedThing(event)
    if (thing) add(thing.placeId, `thing:${String(thing.id)}`)
    const actor = typeof event.actor === 'string' && event.actor.trim() ? event.actor.trim() : null
    const known = actor === null ? undefined : handles.get(actor)?.id ?? registrations.get(actor)
    const key = known !== undefined ? `id:${String(known)}` : actor !== null ? `handle:${actor}` : `event:${String(event.event_id)}:unknown`
    add(event.detail.from_place_id, key); add(event.detail.to_place_id, key); add(event.detail.place_id, key)
    if (registrationFor(event)) add(rootId, key)
  }
  return Object.freeze(Object.fromEntries([...occupants].map(([id, ids]) => [id, ids.size])))
}
