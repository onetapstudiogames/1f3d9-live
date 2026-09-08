import type { ReplayEvent } from './city/types.ts'
import type { ChangesPage } from './city/changes.ts'
import { liveReadSucceeded, newLiveEvents, validContinuation, type LiveReadState } from './live.ts'

/** Complete current reads before the feed so their changes belong to this same refresh. */
export async function readCurrentUpdate<T>(state: LiveReadState, readSnapshot: () => Promise<T>,
  readChanges: (since: string) => Promise<ChangesPage>, now: () => number): Promise<Readonly<{
    snapshot: T; state: LiveReadState; events: readonly ReplayEvent[]
  }>> {
  const snapshot = await readSnapshot()
  let next = state
  const events: ReplayEvent[] = []
  for (;;) {
    const page = await readChanges(next.marker)
    if (!validContinuation(next.marker, page.nextSince, page.hasMore)) throw new Error('The changes continuation did not advance.')
    const fresh = newLiveEvents(next, page.events)
    events.push(...fresh)
    next = liveReadSucceeded(next, page.nextSince, fresh, now())
    if (!page.hasMore) break
  }
  return Object.freeze({ snapshot, state: next, events: Object.freeze(events) })
}
