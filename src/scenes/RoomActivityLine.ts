import type { ReplayEvent } from '../city/types.ts'
import { activityReduce, emptyActivity, type ActivityContext, type ActivityEntry, type ActivityState } from '../activity.ts'

export function activityEntryMatchesRoom(entry: ActivityEntry, roomId: number): boolean {
  if (entry.roomId === roomId || entry.anchorRoomId === roomId) return true
  return entry.kind === 'move' && entry.entities.some(entity => entity.type === 'place' && entity.id === roomId)
}

export function mountRoomActivityLine(context: ActivityContext): RoomActivityLine {
  return new RoomActivityLine(document.getElementById('room-activity')!, context)
}

export class RoomActivityLine {
  private readonly element: HTMLElement
  private readonly context: ActivityContext
  private state: ActivityState = emptyActivity()
  private selectedRoomId: number | null = null

  constructor(element: HTMLElement, context: ActivityContext) {
    this.element = element
    this.context = context
  }

  selectRoom(roomId: number | null): void {
    if (roomId === this.selectedRoomId) return
    this.selectedRoomId = roomId
    this.clear()
  }

  append(rows: readonly ReplayEvent[], recordedNow: number): readonly ActivityEntry[] {
    const next = activityReduce(this.state, rows, recordedNow, this.context)
    if (next === this.state) return Object.freeze([])
    const previousKeys = new Set(this.state.entries.map(entry => entry.key))
    this.state = next
    const added = Object.freeze(next.entries.filter(entry => !previousKeys.has(entry.key)))
    this.showLatest(added)
    return added
  }

  appendEntries(entries: readonly ActivityEntry[]): readonly ActivityEntry[] {
    const keys = new Set(this.state.entries.map(entry => entry.key))
    const added = entries.filter(entry => { if (keys.has(entry.key)) return false; keys.add(entry.key); return true })
    if (!added.length) return Object.freeze([])
    const nextEntries = Object.freeze([...this.state.entries, ...added].slice(-100))
    const seenKeys = Object.freeze([...new Set([...(this.state.seenKeys ?? []), ...added.map(entry => entry.key)])].slice(-1000))
    this.state = Object.freeze({ ...this.state, entries: nextEntries, seenKeys })
    const frozen = Object.freeze(added)
    this.showLatest(frozen)
    return frozen
  }

  snapshot(): ActivityState { return this.state }

  restore(state: ActivityState): void {
    this.state = state
    this.clear()
  }

  reset(rows: readonly ReplayEvent[] = [], recordedNow = Number.NEGATIVE_INFINITY): void {
    this.state = activityReduce(emptyActivity(), rows, recordedNow, this.context)
    this.clear()
  }

  destroy(): void {
    this.selectedRoomId = null
    this.clear()
  }

  private showLatest(entries: readonly ActivityEntry[]): void {
    if (this.selectedRoomId === null) return
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const candidate = entries[index]!
      if (activityEntryMatchesRoom(candidate, this.selectedRoomId)) {
        this.element.textContent = candidate.text
        return
      }
    }
  }

  private clear(): void { this.element.textContent = '' }
}
