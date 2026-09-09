import type { ActivityContext } from './activity.ts'
import type { ReplayEvent } from './city/types.ts'
import { witnessedEvents } from './current-state.ts'

export async function readWitnessedRoom(events: readonly ReplayEvent[], context: ActivityContext,
  currentRoom: () => number | null, read: (rows: readonly ReplayEvent[]) => Promise<readonly ReplayEvent[]>,
  cancelled: () => boolean = () => false): Promise<readonly ReplayEvent[]> {
  for (;;) {
    const room = currentRoom()
    const rows = room === null ? [] : witnessedEvents(events, context, room)
    const complete = await read(rows)
    if (cancelled()) return []
    if (room === currentRoom()) return complete
  }
}
