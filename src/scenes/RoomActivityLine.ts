import type { ReplayEvent } from '../city/types.ts'
import { activityReduce, emptyActivity, type ActivityContext, type ActivityEntry, type ActivityState } from '../activity.ts'

function compareActivityEntries(left: ActivityEntry, right: ActivityEntry): number {
  return left.time - right.time || left.changeId - right.changeId
}

const ROOM_HISTORY_LIMIT = 100

function activityRoomIds(entry: ActivityEntry): readonly number[] {
  const ids = new Set<number>()
  if (entry.roomId != null) ids.add(entry.roomId)
  if (entry.anchorRoomId != null) ids.add(entry.anchorRoomId)
  if (entry.kind === 'move') {
    for (const entity of entry.entities) if (entity.type === 'place') ids.add(entity.id)
  }
  return [...ids]
}

export function activityEntriesForRoom(entries: readonly ActivityEntry[], roomId: number,
  limit = ROOM_HISTORY_LIMIT): readonly ActivityEntry[] {
  return Object.freeze(entries
    .filter(entry => activityRoomIds(entry).includes(roomId))
    .sort(compareActivityEntries)
    .slice(-Math.max(0, limit)))
}

export type RoomActivityScroll = Readonly<{ scrollTop: number; clientHeight: number; scrollHeight: number }>

export function roomActivityScrollTop(before: RoomActivityScroll, nextScrollHeight: number, roomChanged = false): number {
  const maximum = Math.max(0, nextScrollHeight - before.clientHeight)
  const wasAtBottom = before.scrollTop + before.clientHeight >= before.scrollHeight - 1
  return roomChanged || wasAtBottom ? maximum : Math.min(before.scrollTop, maximum)
}

export function roomActivityStripHeight(viewportWidth: number): number {
  return viewportWidth <= 600 ? 40 : 60
}

function historyIncludesSpeech(history: readonly string[], speech: string): boolean {
  const separator = speech.indexOf(': ')
  if (separator < 1) return history.includes(speech)
  const actor = speech.slice(0, separator)
  const body = speech.slice(separator + 2)
  return history.some(text => text === speech || (text.startsWith(`${actor} in `) && text.endsWith(`: ${body}`)))
}

export class RoomActivityLine {
  private readonly element: HTMLElement
  private readonly context: ActivityContext
  private state: ActivityState = emptyActivity()
  private historyLimit = 100
  private selectedRoomId: number | null = null
  private unshownSpeech: string | null = null
  private readonly resize = (): void => this.applyStripHeight()

  constructor(element: HTMLElement, context: ActivityContext) {
    this.element = element
    this.context = context
    this.applyStripHeight()
    if (typeof window !== 'undefined') window.addEventListener('resize', this.resize)
  }

  selectRoom(roomId: number | null): void {
    if (roomId === this.selectedRoomId) return
    this.selectedRoomId = roomId
    this.unshownSpeech = null
    this.renderHistory(true)
  }

  setUnshownSpeech(text: string | null): void {
    const next = text && text.trim() ? text : null
    if (next === this.unshownSpeech) return
    this.unshownSpeech = next
    this.renderHistory()
  }

  append(rows: readonly ReplayEvent[], recordedNow: number): readonly ActivityEntry[] {
    const next = activityReduce(this.state, rows, recordedNow, this.context,
      Math.max(ROOM_HISTORY_LIMIT, this.state.entries.length + rows.length))
    if (next === this.state) return Object.freeze([])
    const previousKeys = new Set(this.state.entries.map(entry => entry.key))
    const added = Object.freeze(next.entries.filter(entry => !previousKeys.has(entry.key)))
    this.state = Object.freeze({ ...next, entries: this.compactEntries(next.entries) })
    this.renderHistory()
    return added
  }

  appendEntries(entries: readonly ActivityEntry[]): readonly ActivityEntry[] {
    const keys = new Set(this.state.entries.map(entry => entry.key))
    const added = entries.filter(entry => { if (keys.has(entry.key)) return false; keys.add(entry.key); return true })
    if (!added.length) return Object.freeze([])
    const nextEntries = this.compactEntries([...this.state.entries, ...added])
    const seenKeys = Object.freeze([...new Set([...(this.state.seenKeys ?? []), ...added.map(entry => entry.key)])].slice(-1000))
    this.state = Object.freeze({ ...this.state, entries: nextEntries, seenKeys })
    const frozen = Object.freeze(added)
    this.renderHistory()
    return frozen
  }

  snapshot(): ActivityState { return this.state }

  restore(state: ActivityState): void {
    this.unshownSpeech = null
    this.state = state
    this.historyLimit = Math.max(100, state.entries.length)
    this.state = Object.freeze({ ...state, entries: this.compactEntries(state.entries) })
    this.renderHistory(true)
  }

  reset(rows: readonly ReplayEvent[] = [], recordedNow = Number.NEGATIVE_INFINITY): void {
    this.unshownSpeech = null
    this.historyLimit = Math.max(100, rows.length)
    this.state = activityReduce(emptyActivity(), rows, recordedNow, this.context, this.historyLimit)
    this.state = Object.freeze({ ...this.state, entries: this.compactEntries(this.state.entries) })
    this.renderHistory(true)
  }

  destroy(): void {
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.resize)
    this.selectedRoomId = null
    this.unshownSpeech = null
    this.clear()
  }

  private compactEntries(entries: readonly ActivityEntry[]): readonly ActivityEntry[] {
    const retainedKeys = new Set<string>()
    const roomIds = new Set(entries.flatMap(entry => activityRoomIds(entry)))
    for (const roomId of roomIds) {
      for (const entry of activityEntriesForRoom(entries, roomId)) retainedKeys.add(entry.key)
    }
    for (const entry of entries.filter(entry => activityRoomIds(entry).length === 0).slice(-ROOM_HISTORY_LIMIT)) {
      retainedKeys.add(entry.key)
    }
    return Object.freeze(entries
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

  private renderHistory(roomChanged = false): void {
    const before = {
      scrollTop: Number(this.element.scrollTop) || 0,
      clientHeight: Number(this.element.clientHeight) || 0,
      scrollHeight: Number(this.element.scrollHeight) || 0,
    }
    this.clear()
    if (!this.selectedRoomIsPublic() || this.selectedRoomId === null) return
    const history = activityEntriesForRoom(this.state.entries, this.selectedRoomId).map(entry => entry.text)
    if (this.unshownSpeech && !historyIncludesSpeech(history, this.unshownSpeech)) history.push(this.unshownSpeech)
    this.element.textContent = history.join('\n')
    if ('scrollTop' in this.element) {
      this.element.scrollTop = roomActivityScrollTop(before, Number(this.element.scrollHeight) || 0, roomChanged)
    }
  }

  private clear(): void { this.element.textContent = '' }

  private applyStripHeight(): void {
    if (!('style' in this.element)) return
    const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth
    const height = `${roomActivityStripHeight(viewportWidth)}px`
    this.element.style.height = height
    this.element.style.minHeight = height
  }
}
