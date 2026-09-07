import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayEvent } from '../src/city/types.ts'
import type { NestedLayout, Room } from '../src/ground/nested.ts'
import { DirectorView } from '../src/scenes/DirectorView.ts'

type Listener = (event: { target: { checked: boolean } }) => void

test('turning Director off while a glide is active stops it and prevents later camera updates', t => {
  const harness = setup()
  t.after(harness.restore)
  harness.control.checked = true; harness.change({ target: harness.control })
  harness.director.update([note('1', 1)], 1_000, 0, layout(), new Set())
  assert.equal(harness.tweens.length, 1)
  assert.equal(harness.tweens[0]!.stopped, false)
  harness.control.checked = false; harness.change({ target: harness.control })
  assert.equal(harness.tweens[0]!.stopped, true)
  assert.equal(harness.director.enabled, false)
  assert.equal(harness.control.checked, false)
  harness.director.update([note('2', 2)], 1_000, 20_000, layout(), new Set())
  assert.equal(harness.tweens.length, 1)
})

test('turning Director off clears its waiting status', t => {
  const harness = setup(); t.after(harness.restore)
  harness.control.checked = true; harness.change({ target: harness.control })
  harness.director.update([], 1_000, 0, layout(), new Set())
  assert.equal(harness.director.status, 'Director is waiting for recent recorded activity.')
  harness.control.checked = false; harness.change({ target: harness.control })
  assert.equal(harness.director.status, '')
  assert.equal(harness.body.dataset['liveDirector'], 'false')
})

test('eight real seconds rotate rooms even while the recorded clock stays paused', t => {
  const harness = setup(); harness.control.checked = true; harness.change({ target: harness.control })
  t.after(harness.restore)
  const events = [note('1', 1), note('2', 2)]
  harness.director.update(events, 1_000, 0, layout(), new Set())
  harness.director.update(events, 1_000, 7_999, layout(), new Set())
  assert.deepEqual(harness.shown, [1])
  harness.director.update(events, 1_000, 8_000, layout(), new Set())
  assert.deepEqual(harness.shown, [1, 2])
})

function setup() {
  let change: Listener = () => undefined
  const control = { checked: false, addEventListener: (_kind: string, listener: Listener) => { change = listener } }
  const body = { dataset: {} as Record<string, string> }
  const previous = globalThis.document
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { body,
    getElementById: () => control, querySelector: () => control } })
  const tweens: { stopped: boolean; stop(): void }[] = []
  const scene = { cameras: { main: { midPoint: { x: 0, y: 0 }, zoom: 1, setZoom() { return this }, centerOn() { return this } } },
    scale: { width: 800, height: 600 }, tweens: { add: () => { const tween = { stopped: false, stop() { this.stopped = true } }; tweens.push(tween); return tween } } }
  const shown: number[] = []; const director = new DirectorView(scene as never, id => shown.push(id)); director.connect(() => undefined)
  return { control, body, tweens, shown, director, get change() { return change }, restore: () =>
    Object.defineProperty(globalThis, 'document', { configurable: true, value: previous }) }
}

function note(changeId: string, placeId: number): ReplayEvent {
  return { change_id: changeId, event_id: Number(changeId), actor: 'lamp', kind: 'note', at: '1970-01-01T00:00:01.000Z', detail: { note_id: Number(changeId), place_id: placeId } }
}
function layout(): NestedLayout {
  const make = (id: number, parentId: number | null): Room => ({ id, parentId, name: String(id), quiet: false, depth: id - 1,
    x: id * 10, y: id * 10, width: 100, height: 80, door: { x: 0, y: 0 }, standing: { x: 0, y: 0, width: 100, height: 80 }, children: id === 1 ? [2] : [] })
  return { rooms: { 1: make(1, null), 2: make(2, 1) }, rootId: 1, width: 200, height: 200 }
}
