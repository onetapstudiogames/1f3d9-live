import type { ReplayEvent } from '../city/types.ts'
import { activityReduce, emptyActivity, type ActivityContext, type ActivityEntry, type ActivityState } from '../activity.ts'

const HISTORY_LIMIT = 200
const compare = (a: ActivityEntry, b: ActivityEntry): number => a.time - b.time || a.changeId - b.changeId

function roomIds(entry: ActivityEntry): readonly number[] {
  const ids = new Set<number>()
  if (entry.roomId != null) ids.add(entry.roomId)
  if (entry.anchorRoomId != null) ids.add(entry.anchorRoomId)
  if (entry.kind === 'move') {
    for (const entity of entry.entities) {
      if (entity.type === 'place') ids.add(entity.id)
    }
  }
  return [...ids]
}

export function activityEntriesWitnessedInRoom(entries: readonly ActivityEntry[], roomId: number | null, limit = HISTORY_LIMIT): readonly ActivityEntry[] {
  return Object.freeze(roomId === null ? [] : entries.filter(entry => roomIds(entry).includes(roomId)).sort(compare).slice(-Math.max(0, limit)))
}

export type RoomActivityScroll = Readonly<{ scrollTop: number; clientHeight: number; scrollHeight: number }>

export function roomActivityScrollTop(before: RoomActivityScroll, nextScrollHeight: number, roomChanged = false): number {
  const maximum = Math.max(0, nextScrollHeight - before.clientHeight)
  const atBottom = before.scrollTop + before.clientHeight >= before.scrollHeight - 1
  return roomChanged || atBottom ? maximum : Math.min(before.scrollTop, maximum)
}

export const roomActivityStripHeight = (width: number): number => width <= 600 ? 40 : 60

function includesSpeech(history: readonly string[], speech: string): boolean {
  const split = speech.indexOf(': ')
  if (split < 1) return history.includes(speech)
  const actor = speech.slice(0, split)
  const body = speech.slice(split + 2)
  return history.some(text => text === speech || (text.startsWith(`${actor} in `) && text.endsWith(`: ${body}`)))
}

export class RoomActivityLine {
  private readonly element: HTMLElement
  private readonly context: ActivityContext
  private state: ActivityState = emptyActivity()
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
    const changed = roomId !== this.selectedRoomId
    this.selectedRoomId = roomId
    if (!this.isPublic()) {
      this.clearHistory()
      return
    }
    if (!changed) return
    this.unshownSpeech = null
    this.render(true)
  }

  setUnshownSpeech(text: string | null): void {
    const next = text?.trim() || null
    if (next === this.unshownSpeech) return
    this.unshownSpeech = next
    this.render()
  }

  append(rows: readonly ReplayEvent[], recordedNow: number): readonly ActivityEntry[] {
    const base = Object.freeze({ ...this.state, entries: Object.freeze([]) })
    const next = activityReduce(base, rows, recordedNow, this.context, Math.max(HISTORY_LIMIT, rows.length))
    if (next === base) return Object.freeze([])
    this.state = Object.freeze({ ...next, entries: this.addWitnessed(this.state.entries, next.entries) })
    this.render()
    return next.entries
  }

  appendEntries(entries: readonly ActivityEntry[]): readonly ActivityEntry[] {
    const seen = new Set(this.state.seenKeys ?? [])
    const added = entries.filter(entry => {
      if (seen.has(entry.key)) return false
      seen.add(entry.key)
      return true
    })
    if (!added.length) return Object.freeze([])
    this.state = Object.freeze({
      ...this.state,
      entries: this.addWitnessed(this.state.entries, added),
      seenKeys: Object.freeze([...seen].slice(-1000)),
    })
    this.render()
    return Object.freeze(added)
  }
  snapshot(): ActivityState { return this.state }
  restore(state: ActivityState): void {
    this.unshownSpeech = null
    this.state = Object.freeze({ ...state, entries: Object.freeze([...state.entries].sort(compare).slice(-HISTORY_LIMIT)) })
    this.render(true)
  }
  reset(_rows: readonly ReplayEvent[] = [], _recordedNow = Number.NEGATIVE_INFINITY): void { this.clearHistory() }
  clearHistory(): void {
    this.unshownSpeech = null
    this.state = emptyActivity()
    this.clearDom()
  }

  destroy(): void {
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.resize)
    this.selectedRoomId = null
    this.clearHistory()
  }

  private addWitnessed(history: readonly ActivityEntry[], added: readonly ActivityEntry[]): readonly ActivityEntry[] {
    if (!this.isPublic()) return history
    const next = [...history]
    const keys = new Set(history.map(entry => entry.key))
    for (const entry of activityEntriesWitnessedInRoom(added, this.selectedRoomId)) {
      if (keys.has(entry.key)) continue
      keys.add(entry.key)
      this.insertOrdered(next, entry)
      if (next.length > HISTORY_LIMIT) keys.delete(next.shift()!.key)
    }
    return Object.freeze(next)
  }

  private insertOrdered(entries: ActivityEntry[], entry: ActivityEntry): void {
    let low = 0
    let high = entries.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (compare(entries[middle]!, entry) <= 0) low = middle + 1
      else high = middle
    }
    entries.splice(low, 0, entry)
  }

  private isPublic(): boolean {
    if (this.selectedRoomId === null) return false
    const seen = new Set<number>()
    let id: number | null = this.selectedRoomId
    while (id !== null) {
      if (seen.has(id)) return false
      seen.add(id)
      const place = this.context.place(id)
      if (!place || place.quiet) return false
      id = place.parentId
    }
    return true
  }

  private render(roomChanged = false): void {
    const before = {
      scrollTop: Number(this.element.scrollTop) || 0,
      clientHeight: Number(this.element.clientHeight) || 0,
      scrollHeight: Number(this.element.scrollHeight) || 0,
    }
    if (!this.isPublic()) {
      this.clearHistory()
      return
    }
    const visible = this.state.entries.map(entry => ({ key: entry.key, text: entry.text }))
    const texts = visible.map(row => row.text)
    if (this.unshownSpeech && !includesSpeech(texts, this.unshownSpeech)) {
      visible.push({ key: '__unshown-speech__', text: this.unshownSpeech })
    }
    this.reconcile(visible)
    if ('scrollTop' in this.element) {
      this.element.scrollTop = roomActivityScrollTop(before, Number(this.element.scrollHeight) || 0, roomChanged)
    }
  }
  private reconcile(entries: readonly { key: string; text: string }[]): void {
    const element = this.element as HTMLElement & { children?: ArrayLike<HTMLElement>; ownerDocument?: Document }
    if (!element.ownerDocument || typeof element.appendChild !== 'function' || !element.children) {
      const text = entries.map(row => row.text).join('\n')
      if (element.textContent !== text) element.textContent = text
      return
    }
    const children = (): HTMLElement[] => Array.from(element.children ?? []) as HTMLElement[]
    const existing = new Map(children().map(node => [node.dataset.activityKey, node]))
    const wanted = new Set(entries.map(row => row.key))
    for (const node of children()) {
      if (!wanted.has(node.dataset.activityKey ?? '')) element.removeChild(node)
    }
    entries.forEach((entry, index) => {
      let node = existing.get(entry.key)
      if (!node) {
        node = element.ownerDocument!.createElement('div')
        node.dataset.activityKey = entry.key
      }
      if (node.textContent !== entry.text) node.textContent = entry.text
      const current = children()[index] ?? null
      if (current !== node) element.insertBefore(node, current)
    })
  }

  private clearDom(): void {
    if (typeof this.element.replaceChildren === 'function') this.element.replaceChildren()
    else if (this.element.textContent !== '') this.element.textContent = ''
  }

  private applyStripHeight(): void {
    if (!('style' in this.element)) return
    const width = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth
    const height = `${roomActivityStripHeight(width)}px`
    this.element.style.height = height
    this.element.style.minHeight = height
  }
}
