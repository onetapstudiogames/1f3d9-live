import { residentNamePlate } from './city/residents.ts'
import type { NestedLayout } from './ground/nested.ts'

type FollowResident = Readonly<{ id: number; handle: string; placeId: number | null }>

export function awakeRoomChoices(residents: Readonly<Record<number, FollowResident>>, layout: NestedLayout | undefined,
  sleepers: ReadonlySet<number>): readonly Readonly<{ id: number; name: string }>[] {
  return Object.freeze(Object.values(residents).flatMap(resident => {
    const name = residentNamePlate(resident.handle)
    return !sleepers.has(resident.id) && name && resident.placeId !== null && layout?.rooms[resident.placeId]
      ? [{ id: resident.id, name }] : []
  }).sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id))
}

export function followRoomState(following: number | null, roomId: number | null,
  residents: Readonly<Record<number, FollowResident>>, sleepers: ReadonlySet<number>): Readonly<{
    following: number | null; roomId: number | null; sleepingId: number | null; message: string | null
  }> {
  const resident = following === null ? undefined : residents[following]
  const asleep = resident && sleepers.has(resident.id)
  return Object.freeze({ following: asleep ? null : following, roomId,
    sleepingId: asleep ? resident.id : null,
    message: asleep ? `${resident.handle} fell asleep. Staying in this room.` : null })
}
