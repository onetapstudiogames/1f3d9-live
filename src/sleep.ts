import type { Resident } from './city/types.ts'

export type SleepTransition = Readonly<{
  residentId: number
  handle: string | null
  placeId: number | null
  asleep: boolean
}>

export function sleepingResidents(census: readonly Resident[]): ReadonlySet<number> {
  return new Set(census.filter(resident => resident.asleep === true).map(resident => resident.id))
}

export function sleepTransitions(previous: readonly Resident[], next: readonly Resident[]): readonly SleepTransition[] {
  const previousById = new Map(previous.map(resident => [resident.id, resident]))
  return Object.freeze(next.flatMap(resident => {
    const prior = previousById.get(resident.id)
    if (!prior || typeof prior.asleep !== 'boolean' || typeof resident.asleep !== 'boolean' || prior.asleep === resident.asleep) return []
    return [Object.freeze({ residentId: resident.id, handle: resident.handle,
      placeId: resident.current_place_id, asleep: resident.asleep })]
  }))
}
