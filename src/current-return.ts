import type { ReplayEvent, Resident } from './city/types.ts'
import type { NestedLayout } from './ground/nested.ts'
import { appliedMove } from './replay/index.ts'
import { createPresentResidents, type Simulation } from './replay/simulation.ts'
import type { ThingReservations } from './things.ts'

/** Removes fresh walks whose destination is already represented by the current visual state. */
export function filterCurrentVisualEvents(
  state: Simulation,
  liveQueue: readonly ReplayEvent[],
  freshEvents: readonly ReplayEvent[],
): readonly ReplayEvent[] {
  const logicalRooms = logicalResidentRooms(state, liveQueue)
  const visualEvents: ReplayEvent[] = []

  for (const event of freshEvents) {
    const move = appliedMove(event)
    const actorId = event.actor ? state.actors.get(event.actor.trim()) : undefined
    if (!move || actorId === undefined) {
      visualEvents.push(event)
      continue
    }

    if (logicalRooms.get(actorId) !== move.toId) visualEvents.push(event)
    logicalRooms.set(actorId, move.toId)
  }

  return Object.freeze(visualEvents)
}

function logicalResidentRooms(state: Simulation, liveQueue: readonly ReplayEvent[]): Map<number, number | null> {
  const rooms = new Map<number, number | null>()
  for (const resident of Object.values(state.residents)) {
    rooms.set(resident.id, resident.walking && resident.destinationId !== null ? resident.destinationId : resident.placeId)
    for (const queued of resident.queue) applyResidentMove(rooms, resident.id, queued.event)
  }
  for (const event of liveQueue) applyActorMove(rooms, state, event)
  return rooms
}

function applyResidentMove(rooms: Map<number, number | null>, residentId: number, event: ReplayEvent): void {
  const move = appliedMove(event)
  if (move) rooms.set(residentId, move.toId)
}

function applyActorMove(rooms: Map<number, number | null>, state: Simulation, event: ReplayEvent): void {
  const move = appliedMove(event)
  const actorId = event.actor ? state.actors.get(event.actor.trim()) : undefined
  if (move && actorId !== undefined) rooms.set(actorId, move.toId)
}

/** Rebuilds the current picture after an unobserved interval, dropping every old card and queued action. */
export function returnToCurrentResidents(
  previous: Simulation,
  census: readonly Resident[],
  layout: NestedLayout,
  reservations: ThingReservations = previous.reservations,
): Simulation {
  return createPresentResidents(census, layout, reservations)
}
