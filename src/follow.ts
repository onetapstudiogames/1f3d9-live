import { residentNamePlate } from './city/residents.ts'
import type { ResidentState } from './replay/simulation.ts'

export type FollowChoice = Readonly<{ id: number; name: string }>

export function followChoices(
  residents: readonly ResidentState[], sleepers: ReadonlySet<number>, showSleepers: boolean, query: string,
): readonly FollowChoice[] {
  const wanted = query.trim().toLocaleLowerCase()
  return Object.freeze(residents.flatMap(resident => {
    const name = residentNamePlate(resident.handle)
    return resident.visible && name !== null && (showSleepers || !sleepers.has(resident.id)) &&
      name.toLocaleLowerCase().includes(wanted) ? [Object.freeze({ id: resident.id, name })] : []
  }).sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) || left.id - right.id))
}
