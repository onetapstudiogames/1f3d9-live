import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayEvent } from '../src/city/types.ts'
import type { ActivityContext } from '../src/activity.ts'
import { ActivityLog, type ActivityElements } from '../src/scenes/ActivityLog.ts'
import type { PixelPortrait } from '../src/scenes/PixelPortrait.ts'

class FakeElement {
  className = ''; textContent = ''; hidden = false; value = 'all'; scrollHeight = 120; scrollTop = 20; clientHeight = 80
  dataset: Record<string, string> = {}; children: FakeElement[] = []; isConnected = true
  private attrs = new Map<string, string>(); private listeners = new Map<string, Set<() => void>>()
  setAttribute(name: string, value: string): void { this.attrs.set(name, value) }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null }
  addEventListener(name: string, listener: () => void): void { (this.listeners.get(name) ?? this.listeners.set(name, new Set()).get(name)!).add(listener) }
  removeEventListener(name: string, listener: () => void): void { this.listeners.get(name)?.delete(listener) }
  dispatch(name: string): void { for (const listener of this.listeners.get(name) ?? []) listener() }
  append(...nodes: FakeElement[]): void { this.children.push(...nodes) }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.disconnect(); this.children = nodes; this.scrollHeight = Math.max(120, nodes.length * 24)
  }
  disconnect(): void { this.isConnected = false; for (const child of this.children) child.disconnect() }
}
class FakeCanvas extends FakeElement {
  width = 0; height = 0
  getContext(): null { return null }
}

const context: ActivityContext = {
  resident: name => ({ type: 'resident', id: 1, name, hasDrawing: false }),
  place: id => ({ id, name: 'room', parentId: null, quiet: false, hasDrawing: false }), roomName: () => 'room',
}
const note: ReplayEvent = { actor: 'author', at: new Date(1_000).toISOString(), change_id: '1', event_id: 1,
  kind: 'note', detail: { note_id: 1, place_id: 2 }, line: '<b>recorded</b>', line_cut: false }

test('renders recorded words as text, filters chats, preserves reading position, and cleans up controls', async () => {
  const previous = globalThis.document
  const fakeDocument = { createElement: (name: string) => name === 'canvas' ? new FakeCanvas() : new FakeElement() }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
  try {
    const panel = new FakeElement(); const toggle = new FakeElement(); const filter = new FakeElement(); const list = new FakeElement()
    toggle.setAttribute('aria-expanded', 'true'); list.scrollTop = 5
    const portraits = { load: async () => [] } as unknown as PixelPortrait
    const log = new ActivityLog({ panel, toggle, filter, list } as unknown as ActivityElements, context, portraits)
    const added = log.append([note], 2_000)
    assert.deepEqual(added.map(entry => entry.key), ['1'])
    assert.equal(list.scrollTop, 5)
    assert.equal(list.children[0]!.children[2]!.textContent, 'author in room: <b>recorded</b>')
    filter.value = 'chats'; filter.dispatch('change'); assert.equal(list.children.length, 1)
    toggle.dispatch('click'); assert.equal(list.hidden, true); assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    const snapshot = log.snapshot()
    assert.deepEqual(log.appendEntries([{ ...added[0]!, key: 'looking:1:1000', cue: 'looking' }]).map(entry => entry.key), ['looking:1:1000'])
    assert.equal(log.appendEntries([{ ...added[0]!, key: 'looking:1:1000', cue: 'looking' }]).length, 0)
    log.restore(snapshot); assert.deepEqual(log.snapshot().entries.map(entry => entry.key), ['1'])
    log.destroy(); assert.equal(list.children.length, 0)
    toggle.dispatch('click'); assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  } finally {
    if (previous === undefined) delete (globalThis as { document?: Document }).document
    else Object.defineProperty(globalThis, 'document', { configurable: true, value: previous })
  }
})
