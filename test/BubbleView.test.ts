import assert from 'node:assert/strict'
import test from 'node:test'

import { BubbleView, positionSpeechLayer } from '../src/scenes/BubbleView.ts'
import { bubbleFor } from '../src/speech.ts'
import type { ReplayEvent } from '../src/city/types.ts'

class StubElement {
  className = ''
  datasetWrites = 0
  textWrites = 0
  private content = ''
  dataset: Record<string, string> = new Proxy({}, { set: (target, key, value) => {
    this.datasetWrites += 1; Reflect.set(target, key, value); return true
  }, deleteProperty: (target, key) => { this.datasetWrites += 1; return Reflect.deleteProperty(target, key) } })
  get textContent(): string { return this.content }
  set textContent(value: string) { this.textWrites += 1; this.content = value }
  children: StubElement[] = []
  offsetLeft = 12
  offsetTop = 20
  clientWidth = 200
  clientHeight = 100
  intrinsicHeight = 0
  scrollTop = 0
  scrollHeight = 640
  removed = false
  styleWrites = 0
  rectReads = 0
  readonly values = new Map<string, string>()
  private readonly styleTarget = Object.assign(this.values, {
    display: '', left: '', top: '', width: '', height: '', minHeight: '', opacity: '', font: '', lineHeight: '', boxSizing: '',
    setProperty: (name: string, value: string) => {
      this.styleWrites += 1; this.values.set(name, value)
    },
    getPropertyValue: (name: string) => this.values.get(name) ?? '',
  })
  style = new Proxy(this.styleTarget, { set: (target, key, value) => {
    this.styleWrites += 1
    return Reflect.set(target, key, value)
  } })
  append(child: StubElement): void { this.children.push(child) }
  remove(): void { this.removed = true }
  getBoundingClientRect(): DOMRect {
    this.rectReads += 1
    const top = Number.parseFloat(this.style.top || String(this.offsetTop))
    const height = this.intrinsicHeight || Number.parseFloat(this.style.height || this.style.minHeight || String(this.clientHeight))
    return { bottom: top + height, height } as DOMRect
  }
}

test('BubbleView reuses safe DOM text and keeps scrolling speech in the room', t => {
  const previous = globalThis.document
  const app = new StubElement()
  const layer = new StubElement()
  const root = new StubElement()
  const elements = new Map([['#app', app], ['#speech-layer', layer]])
  const fakeDocument = {
    documentElement: root,
    createElement: (tag: string) => tag === 'canvas'
      ? { getContext: () => ({ font: '', measureText: (text: string) => ({ width: [...text].length * 8 }) }) }
      : new StubElement(),
    querySelector: (selector: string) => elements.get(selector) ?? null,
    querySelectorAll: () => layer.children.filter(child => child.className === 'room-speech-card'),
  } as unknown as Document
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
  t.after(() => Object.defineProperty(globalThis, 'document', { configurable: true, value: previous }))

  const event: ReplayEvent = { actor: 'ada', at: '2026-01-01T00:00:00Z', change_id: '1', event_id: 1,
    kind: 'note', detail: { place_id: 3, note_id: 7 }, line: `<b>${'whole words '.repeat(30)}</b>` }
  const bubble = bubbleFor(event, 0)!
  const view = new BubbleView(4)
  const card = layer.children[0]!
  card.intrinsicHeight = 40
  view.update({ ...bubble, text: 'brief' }, { x: 100, y: 240 }, { width: 200, height: 300 }, 'plain', bubble.expiresAt - 1)
  assert.ok(Number.parseFloat(card.style.top) + 40 <= 300)
  const frame = view.update(bubble, { x: 100, y: 40 }, { width: 200, height: 100 }, 'plain', bubble.expiresAt - 1)!
  assert.equal(card.children[0]!.textContent, frame.text)
  assert.equal(card.children[0]!.children.length, 0)
  assert.equal(card.dataset['residentId'], '4')
  assert.equal(card.dataset['noteId'], '7')
  assert.equal(card.dataset['complete'], 'true')
  assert.equal(card.dataset['revealed'], frame.revealed)
  assert.equal(card.style.width, `${frame.width}px`)
  assert.equal(card.style.height, `${frame.height}px`)
  assert.equal(card.children[0]!.scrollTop, 540)
  assert.ok(Number.parseFloat(card.style.top) + 40 <= 100)
  const textWrites = card.children[0]!.textWrites
  const datasetWrites = card.datasetWrites
  const styleWrites = card.styleWrites
  const rectReads = card.rectReads
  view.update(bubble, { x: 100, y: 40 }, { width: 200, height: 100 }, 'plain', bubble.expiresAt - 1)
  assert.equal(card.children[0]!.textWrites, textWrites)
  assert.equal(card.datasetWrites, datasetWrites)
  assert.equal(card.styleWrites, styleWrites)
  assert.equal(card.rectReads, rectReads)
  assert.equal(positionSpeechLayer(), true)
  assert.equal(layer.style.left, '12px')
  const layerWrites = layer.styleWrites
  assert.equal(positionSpeechLayer(), true)
  assert.equal(layer.styleWrites, layerWrites)
  const pausingBubble = { text: 'Hi there. More words', cut: false, placeId: 3,
    startedAt: 1_000, charInterval: 100, expiresAt: 5_000 }
  view.update(pausingBubble, { x: 100, y: 40 }, { width: 200, height: 100 }, 'plain', 1_300)
  const pauseAt = view.pauseAt(1_300)
  assert.equal(pauseAt, 1_600)
  const pausedFrame = view.update(pausingBubble, { x: 100, y: 40 }, { width: 200, height: 100 }, 'plain', pauseAt)!
  assert.equal(pausedFrame.revealed, 'Hi there.')
  const wrappedBubble = { ...pausingBubble, text: 'alpha beta gamma' }
  card.children[0]!.clientWidth = 50
  view.update(wrappedBubble, { x: 50, y: 40 }, { width: 100, height: 100 }, 'plain', 1_200)
  const linePauseAt = view.pauseAt(1_200)
  const lineFrame = view.update(wrappedBubble, { x: 50, y: 40 }, { width: 100, height: 100 }, 'plain', linePauseAt)!
  assert.equal(lineFrame.revealed, 'alpha ')
  view.update(null, { x: 0, y: 0 }, { width: 200, height: 100 }, 'plain', 0)
  assert.equal(card.style.display, 'none')
  assert.equal(view.pauseAt(777), 777)
  layer.style.left = 'unchanged'
  assert.equal(positionSpeechLayer(), false)
  assert.equal(layer.style.left, 'unchanged')
  view.destroy()
  assert.equal(card.removed, true)
})
