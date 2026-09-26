import type { ReplayEvent } from './city/types.ts'
import type { NestedLayout } from './ground/nested.ts'
import { freeDestination, placeVisible, type Simulation } from './replay/simulation.ts'
import { bubbleFor } from './speech.ts'

/**
 * Show a verified line on its speaker's card at once. A line never waits for a note's turn;
 * it replaces the speaker's current card, and the room log keeps every word either way.
 */
export function withLineBubble(state: Simulation, event: ReplayEvent, now: number,
  roomId: number | null, sleepers: ReadonlySet<number>, layout: NestedLayout,
): Readonly<{ state: Simulation; shown: boolean; relocated: boolean }> {
  const hidden = Object.freeze({ state, shown: false, relocated: false })
  if (roomId === null || event.kind !== 'line_said' || event.detail.place_id !== roomId || !placeVisible(layout, roomId)) return hidden
  if (typeof event.actor !== 'string') return hidden
  const bubble = bubbleFor(event, now)
  if (!bubble || bubble.size !== 'line') return hidden
  const residentId = state.actors.get(event.actor.trim())
  if (residentId === undefined || sleepers.has(residentId)) return hidden
  const resident = state.residents[residentId]
  if (!resident || resident.walking || resident.queue.length > 0) return hidden

  if (resident.placeId === roomId) {
    const nextResident = Object.freeze({ ...resident, bubble })
    const nextResidents = Object.freeze({ ...state.residents, [residentId]: nextResident })
    return Object.freeze({ state: Object.freeze({ ...state, residents: nextResidents }), shown: true, relocated: false })
  }

  const destination = freeDestination(residentId, roomId, state.residents, layout, state.reservations)
  if (!destination) return hidden
  const nextResident = Object.freeze({ ...resident, placeId: roomId, x: destination.x, y: destination.y,
    relocatedAt: now, visible: true, bubble })
  const nextResidents = Object.freeze({ ...state.residents, [residentId]: nextResident })
  return Object.freeze({ state: Object.freeze({ ...state, residents: nextResidents }), shown: true, relocated: true })
}
