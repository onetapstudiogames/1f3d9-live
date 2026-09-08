import assert from 'node:assert/strict'
import Module from 'node:module'
import test from 'node:test'

test('ResidentView forwards speech pause timing to its real BubbleView member', async () => {
  const noop = (): void => {}
  const context = new Proxy({ getImageData: () => ({ data: [0, 0, 0, 0] }) }, {
    get: (target, key) => key in target ? Reflect.get(target, key) : noop,
  })
  class StubCanvas {}
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: globalThis },
    navigator: { configurable: true, value: { userAgent: 'node', maxTouchPoints: 0 } },
    Image: { configurable: true, value: class { width = 1; height = 1 } },
    HTMLCanvasElement: { configurable: true, value: StubCanvas },
    document: { configurable: true, value: {
      documentElement: {},
      createElement: () => Object.assign(new StubCanvas(), {
        getContext: () => context, style: {}, addEventListener: noop, removeEventListener: noop,
      }),
    } },
  })
  const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown }
  const originalLoad = loader._load
  loader._load = (request, parent, isMain) => request === 'phaser3spectorjs' ? {} : originalLoad(request, parent, isMain)
  const { ResidentView } = await import('../src/scenes/ResidentView.ts').finally(() => { loader._load = originalLoad })
  const calls: number[] = []
  const view = Object.create(ResidentView.prototype) as InstanceType<typeof ResidentView>
  Object.defineProperty(view, 'bubble', { value: { pauseAt(now: number) { calls.push(now); return now + 75 } } })

  assert.equal(view.speechPauseAt(1_300), 1_375)
  assert.deepEqual(calls, [1_300])
})
