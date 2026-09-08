import assert from 'node:assert/strict'
import test from 'node:test'

import { BubbleView, updateSpeechOverflow } from '../src/scenes/BubbleView.ts'
import { bubbleFor } from '../src/speech.ts'
import type { ReplayEvent } from '../src/city/types.ts'

class StubElement {
  className = ''
  dataset: Record<string, string> = {}
  textContent = ''
  children: StubElement[] = []
  offsetLeft = 12
  offsetTop = 20
  clientWidth = 200
  clientHeight = 100
  intrinsicHeight = 0
  removed = false
  readonly values = new Map<string, string>()
  style = Object.assign(this.values, {
    display: '', left: '', top: '', width: '', height: '', minHeight: '', opacity: '', font: '', lineHeight: '',
    setProperty: (name: string, value: string) => { this.values.set(name, value) },
  })
  append(child: StubElement): void { this.children.push(child) }
  remove(): void { this.removed = true }
  getBoundingClientRect(): DOMRect {
    const top = Number.parseFloat(this.style.top || String(this.offsetTop))
    const height = this.intrinsicHeight || Number.parseFloat(this.style.height || this.style.minHeight || String(this.clientHeight))
    return { bottom: top + height, height } as DOMRect
  }
}

test('BubbleView reuses safe DOM text and reports page overflow', t => {
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
  card.intrinsicHeight = 400
  // A font change can make native layout taller than the initial measurement.
  // The estimate would fit above; the rendered card must move below the speaker.
  view.update({ ...bubble, text: 'brief' }, { x: 100, y: 240 }, { width: 200, height: 300 }, 'plain', bubble.expiresAt - 1)
  assert.equal(card.style.top, '292px')
  const frame = view.update(bubble, { x: 100, y: 40 }, { width: 200, height: 100 }, 'plain', bubble.expiresAt - 1)!
  assert.equal(card.children[0]!.textContent, frame.revealed)
  assert.equal(card.children[0]!.children.length, 0)
  assert.equal(card.dataset['residentId'], '4')
  assert.equal(card.dataset['noteId'], '7')
  assert.equal(card.dataset['complete'], 'true')
  assert.equal(card.dataset['revealed'], event.line)
  assert.ok(card.children[0]!.textContent.includes('<b>'))
  assert.equal(card.style.width, `${frame.width}px`)
  assert.equal(card.style.height, 'auto')
  assert.equal(card.style.minHeight, `${frame.height}px`)
  assert.equal(card.style.top, '92px')
  assert.ok(updateSpeechOverflow() > 0)
  assert.equal(root.dataset['tallSpeech'], 'true')
  view.update(null, { x: 0, y: 0 }, { width: 200, height: 100 }, 'plain', 0)
  assert.equal(card.style.display, 'none')
  assert.equal(updateSpeechOverflow(), 0)
  assert.equal(root.dataset['tallSpeech'], 'false')
  view.destroy()
  assert.equal(card.removed, true)
})
