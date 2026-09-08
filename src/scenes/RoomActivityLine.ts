import type { ReplayEvent } from '../city/types.ts'
import { activityReduce, emptyActivity, type ActivityContext, type ActivityEntry, type ActivityState } from '../activity.ts'

function compareActivityEntries(left: ActivityEntry, right: ActivityEntry): number {
  return left.time - right.time || left.changeId - right.changeId
}

export class RoomActivityLine {
  private readonly element: HTMLElement
  private readonly context: ActivityContext
  private state: ActivityState = emptyActivity()
  private historyLimit = 100
  private latestByRoom = new Map<number, ActivityEntry>()
  private selectedRoomId: number | null = null
  private unshownSpeech: string | null = null

  constructor(element: HTMLElement, context: ActivityContext) {
    this.element = element
    this.context = context
  }

  selectRoom(roomId: number | null): void {
    if (roomId === this.selectedRoomId) return
    this.selectedRoomId = roomId
    this.unshownSpeech = null
    this.renderLatest()
  }

  setUnshownSpeech(text: string | null): void {
    const next = text && text.trim() ? text : null
    if (next === this.unshownSpeech) return
    this.unshownSpeech = next
    this.renderLatest()
  }

  append(rows: readonly ReplayEvent[], recordedNow: number): readonly ActivityEntry[] {
    const next = activityReduce(this.state, rows, recordedNow, this.context, this.historyLimit)
    if (next === this.state) return Object.freeze([])
    const previousKeys = new Set(this.state.entries.map(entry => entry.key))
    const added = Object.freeze(next.entries.filter(entry => !previousKeys.has(entry.key)))
    this.rememberLatest(added)
    this.state = Object.freeze({ ...next, entries: this.compactEntries(next.entries) })
    this.renderLatest()
    return added
  }

  appendEntries(entries: readonly ActivityEntry[]): readonly ActivityEntry[] {
    const keys = new Set(this.state.entries.map(entry => entry.key))
    const added = entries.filter(entry => { if (keys.has(entry.key)) return false; keys.add(entry.key); return true })
    if (!added.length) return Object.freeze([])
    this.rememberLatest(added)
    const nextEntries = this.compactEntries([...this.state.entries, ...added])
    const seenKeys = Object.freeze([...new Set([...(this.state.seenKeys ?? []), ...added.map(entry => entry.key)])].slice(-1000))
    this.state = Object.freeze({ ...this.state, entries: nextEntries, seenKeys })
    const frozen = Object.freeze(added)
    this.renderLatest()
    return frozen
  }

  snapshot(): ActivityState { return this.state }

  restore(state: ActivityState): void {
    this.unshownSpeech = null
    this.state = state
    this.historyLimit = Math.max(100, state.entries.length)
    this.rebuildLatest(state.entries)
    this.state = Object.freeze({ ...state, entries: this.compactEntries(state.entries) })
    this.renderLatest()
  }

  reset(rows: readonly ReplayEvent[] = [], recordedNow = Number.NEGATIVE_INFINITY): void {
    this.unshownSpeech = null
    this.historyLimit = Math.max(100, rows.length)
    this.state = activityReduce(emptyActivity(), rows, recordedNow, this.context, this.historyLimit)
    this.rebuildLatest(this.state.entries)
    this.state = Object.freeze({ ...this.state, entries: this.compactEntries(this.state.entries) })
    this.renderLatest()
  }

  destroy(): void {
    this.selectedRoomId = null
    this.unshownSpeech = null
    this.clear()
  }

  private roomIds(entry: ActivityEntry): readonly number[] {
    const ids = new Set<number>()
    if (entry.roomId != null) ids.add(entry.roomId)
    if (entry.anchorRoomId != null) ids.add(entry.anchorRoomId)
    if (entry.kind === 'move') {
      for (const entity of entry.entities) if (entity.type === 'place') ids.add(entity.id)
    }
    return [...ids]
  }

  private rememberLatest(entries: readonly ActivityEntry[]): void {
    const latest = new Map(this.latestByRoom)
    for (const entry of entries) {
      for (const roomId of this.roomIds(entry)) {
        const current = latest.get(roomId)
        if (!current || compareActivityEntries(current, entry) <= 0) latest.set(roomId, entry)
      }
    }
    this.latestByRoom = latest
  }

  private rebuildLatest(entries: readonly ActivityEntry[]): void {
    this.latestByRoom = new Map()
    this.rememberLatest(entries)
  }

  private compactEntries(entries: readonly ActivityEntry[]): readonly ActivityEntry[] {
    const retainedKeys = new Set([...this.latestByRoom.values()].map(entry => entry.key))
    for (const entry of entries.slice(-this.historyLimit)) retainedKeys.add(entry.key)
    const candidates = new Map<string, ActivityEntry>()
    for (const entry of [...this.latestByRoom.values(), ...entries]) candidates.set(entry.key, entry)
    return Object.freeze([...candidates.values()]
      .filter(entry => retainedKeys.has(entry.key))
      .sort(compareActivityEntries))
  }

  private selectedRoomIsPublic(): boolean {
    if (this.selectedRoomId === null) return false
    const visited = new Set<number>()
    let roomId: number | null = this.selectedRoomId
    while (roomId !== null) {
      if (visited.has(roomId)) return false
      visited.add(roomId)
      const place = this.context.place(roomId)
      if (!place || place.quiet) return false
      roomId = place.parentId
    }
    return true
  }

  private renderLatest(): void {
    this.clear()
    if (!this.selectedRoomIsPublic() || this.selectedRoomId === null) return
    this.element.textContent = this.unshownSpeech ?? this.latestByRoom.get(this.selectedRoomId)?.text ?? ''
  }

  private clear(): void { this.element.textContent = '' }
}
