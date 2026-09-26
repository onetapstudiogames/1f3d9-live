import type { ReplayEvent } from './city/types.ts'
import type { Simulation } from './replay/simulation.ts'

export type RemovedTalkIds = Readonly<{ lineIds: ReadonlySet<number>; pingIds: ReadonlySet<number> }>

export function removedTalkIds(events: readonly ReplayEvent[]): RemovedTalkIds {
  const lineIds = new Set<number>()
  const pingIds = new Set<number>()
  for (const event of events) {
    if (event.kind !== 'moderation' || event.detail.action !== 'remove'
      || !Number.isSafeInteger(event.detail.target_id) || (event.detail.target_id as number) < 1) continue
    if (event.detail.target_type === 'line') lineIds.add(event.detail.target_id as number)
    else if (event.detail.target_type === 'ping') pingIds.add(event.detail.target_id as number)
  }
  return Object.freeze({ lineIds, pingIds })
}

export function withoutLineBubbles(state: Simulation, lineIds: ReadonlySet<number>): Simulation {
  if (lineIds.size === 0 || !Object.values(state.residents).some(resident =>
    resident.bubble?.lineId !== undefined && lineIds.has(resident.bubble.lineId))) return state
  const residents = Object.fromEntries(Object.entries(state.residents).map(([id, resident]) => [id,
    resident.bubble?.lineId !== undefined && lineIds.has(resident.bubble.lineId)
      ? Object.freeze({ ...resident, bubble: null }) : resident])) as Simulation['residents']
  return Object.freeze({ ...state, residents: Object.freeze(residents) })
}
