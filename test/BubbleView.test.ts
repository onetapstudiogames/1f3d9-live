import assert from 'node:assert/strict'
import test from 'node:test'

import { BubbleView, positionSpeechLayer, visibleSpeechCardRects } from '../src/scenes/BubbleView.ts'
import { actionCaption, actionCaptionLaneHeight, layoutActionCaptions } from '../src/action-captions.ts'
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
  querySelector(selector: string): StubElement | null { return selector === '.room-speech-words' ? this.children[0] ?? null : null }
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
    querySelectorAll: (selector: string) => layer.children.filter(child => selector.includes(`.${child.className}`)),
  } as unknown as Document
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
  t.after(() => Object.defineProperty(globalThis, 'document', { configurable: true, value: previous }))

  const event: ReplayEvent = { actor: 'ada', at: '2026-01-01T00:00:00Z', change_id: '1', event_id: 1,
    kind: 'note', detail: { place_id: 3, note_id: 7 }, line: `<b>${'whole words '.repeat(30)}</b>` }
  const bubble = bubbleFor(event, 0)!
  const view = new BubbleView(4)
  const card = layer.children[0]!
  assert.equal(view.update(bubble, { x: 100, y: 40 }, { width: 200, height: 100 }, 'plain', -1), null)
  assert.equal(card.style.display, 'none')
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
  const nextEvent: ReplayEvent = { ...event, change_id: '2', event_id: 2, detail: { place_id: 3, note_id: 8 }, line: 'second speech' }
  const nextBubble = bubbleFor(nextEvent, bubble.expiresAt)!
  assert.equal(view.update(nextBubble, { x: 100, y: 40 }, { width: 200, height: 100 }, 'plain', nextBubble.startedAt - 1), null)
  assert.equal(card.style.display, 'none')
  assert.equal(card.children[0]!.textContent, '')
  assert.equal(card.dataset['revealed'], undefined)
  assert.equal(card.dataset['complete'], undefined)
  assert.equal(card.dataset['noteId'], undefined)
  view.update(null, { x: 0, y: 0 }, { width: 200, height: 100 }, 'plain', 0)
  assert.equal(card.style.display, 'none')
  assert.equal(card.children[0]!.textContent, '')
  assert.equal(card.dataset['revealed'], undefined)
  assert.equal(card.dataset['complete'], undefined)
  assert.equal(card.dataset['noteId'], undefined)
  layer.style.left = 'unchanged'
  assert.equal(positionSpeechLayer(), false)
  assert.equal(layer.style.left, 'unchanged')
  const caption = new StubElement(); caption.className = 'room-action-caption'; layer.append(caption)
  assert.equal(positionSpeechLayer(), true)
  assert.equal(layer.style.left, '12px')
  card.style.display = ''; card.style.top = '8px'; card.style.left = '8px'; card.style.width = '184px'; card.style.height = '280px'; card.intrinsicHeight = 0
  card.children[0]!.scrollTop = 540
  const activity = actionCaption({ key: 'action', changeId: 2, time: 0, kind: 'event', text: 'ada used a brass bell.', cue: 'use',
    actorResidentId: 4, entities: [{ type: 'resident', id: 4, name: 'ada', hasDrawing: true }] }, 0)!
  const lane = actionCaptionLaneHeight([activity], 300)
  const speechRects = visibleSpeechCardRects(new Set([4]), 300, lane)
  assert.equal(card.children[0]!.scrollTop, 540)
  const captions = layoutActionCaptions([activity], { 4: { id: 4, x: 100, y: 150, visible: true } }, { width: 200, height: 300 }, speechRects)
  assert.equal(captions.length, 1)
  assert.ok(speechRects[0]!.y + speechRects[0]!.height <= captions[0]!.y || captions[0]!.y + captions[0]!.height <= speechRects[0]!.y)
  card.style.height = '280px'; card.children[0]!.scrollTop = 100
  visibleSpeechCardRects(new Set([4]), 300, lane)
  assert.equal(card.children[0]!.scrollTop, 100)
  view.destroy()
  assert.equal(card.removed, true)
})
