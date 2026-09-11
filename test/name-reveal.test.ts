import assert from 'node:assert/strict'
import test from 'node:test'
import { NameReveal, positionNameLayer } from '../src/scenes/NameReveal.ts'

class Element {
  className = ''; dataset: Record<string, string> = {}; style: Record<string, string> = {}
  textContent = ''; title = ''; type = ''; hidden = false; removed = false
  offsetLeft = 6; offsetTop = 36; clientWidth = 375; clientHeight = 640
  children: Element[] = []; listeners: Record<string, () => void> = {}
  append(...children: Element[]) { this.children.push(...children) }
  setAttribute(name: string, value: string) { this.dataset[name === 'aria-label' ? 'ariaLabel' : name] = value }
  addEventListener(name: string, listener: () => void) { this.listeners[name] = listener }
  remove() { this.removed = true }
}

test('long-name overlay reveals the full name on hover or tap and tracks the visible plate', t => {
  const previous = globalThis.document
  const app = new Element(); const layer = new Element()
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => new Element(),
    querySelector: (selector: string) => selector === '#app' ? app : selector === '#name-layer' ? layer : null,
  } })
  t.after(() => Object.defineProperty(globalThis, 'document', { configurable: true, value: previous }))
  const reveal = new NameReveal('World-Stamped Copper Lantern')
  reveal.update({ x: 20, y: 40, width: 124, height: 23 })
  reveal.setVisible(true)
  const hit = layer.children[0]!; const bubble = layer.children[1]!
  assert.equal(hit.title, 'World-Stamped Copper Lantern')
  assert.equal(hit.dataset['ariaLabel'], 'Show full name: World-Stamped Copper Lantern')
  assert.equal(hit.dataset['role'], 'button')
  assert.equal(bubble.textContent, 'World-Stamped Copper Lantern')
  assert.deepEqual(hit.style, { display: '', left: '20px', top: '40px', width: '124px', height: '23px' })
  assert.deepEqual(bubble.style, { left: '114px', right: 'auto', top: '67px' })
  hit.listeners['click']!(); assert.equal(hit.dataset['open'], 'true')
  hit.listeners['blur']!(); assert.equal(hit.dataset['open'], 'false')
  assert.equal(positionNameLayer(), true)
  assert.deepEqual(layer.style, { left: '6px', top: '36px', width: '375px', height: '640px' })
  reveal.destroy(); assert.equal(hit.removed, true); assert.equal(bubble.removed, true)
})
