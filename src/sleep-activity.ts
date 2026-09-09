import type { ActivityEntry } from './activity.ts'
import type { NestedLayout } from './ground/nested.ts'
import { roomIsPublic } from './room-view.ts'
import type { SleepTransition } from './sleep.ts'

// The census records the state change; this time is when the viewer observed it.
export function sleepActivityEntries(changes: readonly SleepTransition[], layout: NestedLayout | undefined,
  observedAt: number): readonly ActivityEntry[] {
  if (!layout || !Number.isFinite(observedAt)) return Object.freeze([])
  return Object.freeze(changes.flatMap(change => {
    const name = change.handle?.trim()
    const room = change.placeId === null ? undefined : layout.rooms[change.placeId]
    if (!name || !room || !roomIsPublic(layout, room.id)) return []
    return [Object.freeze({ key: `sleep:${change.residentId}:${observedAt}:${change.asleep}`,
      changeId: 0, time: observedAt, kind: 'event' as const,
      text: `${name} ${change.asleep ? 'fell asleep' : 'woke up'}.`,
      entities: Object.freeze([
        { type: 'resident' as const, id: change.residentId, name, hasDrawing: null },
        { type: 'place' as const, id: room.id, name: room.name, hasDrawing: null },
      ]), roomId: room.id, actorResidentId: change.residentId })]
  }))
}
