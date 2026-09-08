import assert from 'node:assert/strict'
import Module from 'node:module'
import test from 'node:test'
import { visibleRoomLabels } from '../src/room-crowding.ts'

test('NameLabel moves its existing full-name text inside a fixed mask', async () => {
  const noop = (): void => {}
  class StubCanvas {}
  const context = new Proxy({ getImageData: () => ({ data: [0, 0, 0, 0] }) }, {
    get: (target, key) => key in target ? Reflect.get(target, key) : noop,
  })
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: Object.assign(globalThis, { devicePixelRatio: 2 }) },
    navigator: { configurable: true, value: { userAgent: 'node', maxTouchPoints: 0 } },
    Image: { configurable: true, value: class { width = 1; height = 1 } },
    HTMLCanvasElement: { configurable: true, value: StubCanvas },
    document: { configurable: true, value: { documentElement: {}, createElement: () => Object.assign(new StubCanvas(), {
      getContext: () => context, style: {}, addEventListener: noop, removeEventListener: noop,
    }) } },
  })
  const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown }
  const originalLoad = loader._load
  loader._load = (request, parent, isMain) => request === 'phaser3spectorjs' ? {} : originalLoad(request, parent, isMain)
  const { NameLabel } = await import('../src/scenes/NameLabel.ts').finally(() => { loader._load = originalLoad })
  const texts: FakeText[] = []
  let addedGraphics = 0
  const scene = { add: {
    graphics: () => { addedGraphics += 1; return new FakeGraphics() },
    text: (_x: number, _y: number, value: string) => { const text = new FakeText(value); texts.push(text); return text },
  }, make: { graphics: () => new FakeGraphics() } }
  const label = new NameLabel(scene as never, 'The astonishingly complete lantern name', 'thing')
  label.setAllowed(true)
  label.update(100, 50, 1, 1_200)
  const start = texts[0]!.x
  label.update(100, 50, 1, 2_200)

  assert.equal(texts[0]!.value, 'The astonishingly complete lantern name')
  assert.equal(texts[0]!.setTextCalls, 0)
  assert.equal(texts[0]!.x, start - 18)
  assert.equal(texts[1]!.visible, false)
  assert.equal(addedGraphics, 1)
  assert.deepEqual(label.bounds(), { x: 38, y: 50, width: 124, height: 23 })
})

test('NameLabel uses measured short-name geometry for drawing, masking, bounds, and collisions', async () => {
  const { NameLabel } = await loadNameLabel()
  const graphics: FakeGraphics[] = []
  const styles: Record<string, unknown>[] = []
  const scene = { add: {
    graphics: () => { const value = new FakeGraphics(); graphics.push(value); return value },
    text: (_x: number, _y: number, value: string, style: Record<string, unknown>) => {
      styles.push(style); return new FakeText(value)
    },
  }, make: { graphics: () => { const value = new FakeGraphics(); graphics.push(value); return value } } }
  const first = new NameLabel(scene as never, 'Ada')
  const second = new NameLabel(scene as never, 'Bea')
  first.setAllowed(true); second.setAllowed(true)
  first.update(100, 50, 1, 0); second.update(164, 50, 1, 0)

  assert.deepEqual(first.bounds(), { x: 82, y: 50, width: 36, height: 23 })
  assert.deepEqual(second.bounds(), { x: 146, y: 50, width: 36, height: 23 })
  assert.deepEqual([...visibleRoomLabels([
    { ...first.bounds()!, id: 'first', priority: 0 },
    { ...second.bounds()!, id: 'second', priority: 0 },
  ])], ['first', 'second'])
  assert.deepEqual(graphics[0]!.roundedRects, [[-17, 2, 36, 23, 6], [-18, 0, 36, 23, 6]])
  assert.deepEqual(graphics[1]!.rects, [[-12, 0, 24, 23]])
  assert.equal(styles[0]!.fontSize, '13px')
})

async function loadNameLabel() {
  const noop = (): void => {}
  class StubCanvas {}
  const context = new Proxy({ getImageData: () => ({ data: [0, 0, 0, 0] }) }, {
    get: (target, key) => key in target ? Reflect.get(target, key) : noop,
  })
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: Object.assign(globalThis, { devicePixelRatio: 2 }) },
    navigator: { configurable: true, value: { userAgent: 'node', maxTouchPoints: 0 } },
    Image: { configurable: true, value: class { width = 1; height = 1 } },
    HTMLCanvasElement: { configurable: true, value: StubCanvas },
    document: { configurable: true, value: { documentElement: {}, createElement: () => Object.assign(new StubCanvas(), {
      getContext: () => context, style: {}, addEventListener: noop, removeEventListener: noop,
    }) } },
  })
  const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown }
  const originalLoad = loader._load
  loader._load = (request, parent, isMain) => request === 'phaser3spectorjs' ? {} : originalLoad(request, parent, isMain)
  return import('../src/scenes/NameLabel.ts').finally(() => { loader._load = originalLoad })
}

class FakeGraphics {
  visible = true
  roundedRects: number[][] = []
  rects: number[][] = []
  setDepth() { return this }
  clear() { this.roundedRects = []; this.rects = []; return this }
  fillStyle() { return this }
  fillRoundedRect(...values: number[]) { this.roundedRects.push(values); return this }
  fillRect(...values: number[]) { this.rects.push(values); return this }
  createGeometryMask() { return { destroy() {} } }
  setPosition() { return this }
  setScale() { return this }
  setVisible(value: boolean) { this.visible = value; return this }
  setAlpha() { return this }
  destroy() {}
}

class FakeText {
  x = 0
  visible = true
  setTextCalls = 0
  style = { resolution: 2 }
  texture = { setFilter() {} }
  value: string
  constructor(value: string) { this.value = value }
  get width() { return this.value.length * 8 }
  setOrigin() { return this }
  setDepth() { return this }
  setMask() { return this }
  setText(value: string) { this.value = value; this.setTextCalls += 1; return this }
  setResolution(value: number) { this.style.resolution = value; return this }
  setPosition(x: number) { this.x = x; return this }
  setScale() { return this }
  setVisible(value: boolean) { this.visible = value; return this }
  setAlpha() { return this }
  destroy() {}
}
