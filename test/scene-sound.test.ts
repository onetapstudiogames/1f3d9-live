import assert from 'node:assert/strict'
import test from 'node:test'
import { SceneSound } from '../src/scenes/SceneSound.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { pointAlongPath } from '../src/ground/path.ts'

test('the sound adapter consumes water footsteps silently and resumes normal land cadence', t => {
  const h = setup(); t.after(h.restore)
  h.documentEvents.emit('pointerdown', true)
  const layout = nestedLayout([{ id: 1, parent_id: null }, { id: 2, parent_id: 1 }])
  const room = layout.rooms[2]!
  const path = [{ x: room.x + 20, y: room.y + 60 }, { x: room.x, y: room.y + 60 },
    { x: room.x - 20, y: room.y + 60 }]
  const update = (progress: number, now: number) => {
    const point = pointAlongPath(path, progress)
    h.updateWalk({ ...point, id: 1, path, pathProgress: progress, walking: true,
      walkEventId: 'recorded-move', walkElapsed: now, bubble: null }, layout, now)
  }
  update(0.25, 100)
  assert.equal(h.voices.length, 1)
  update(0.75, 520); update(0.8, 940)
  assert.equal(h.voices.length, 1, 'water movement does not play footsteps')
  assert.equal((h.doc.body.dataset as Record<string, string>)['liveBoating'], '1')
  update(0.25, 1360)
  assert.equal(h.voices.length, 2)
  update(0.3, 1370)
  assert.equal(h.voices.length, 2, 'returning to land cannot play back missed water ticks')
  assert.equal((h.doc.body.dataset as Record<string, string>)['liveBoating'], '')
})

test('a remembered on choice stays silent until a trusted keyboard gesture, even with running audio', t => {
  const h = setup(); t.after(h.restore)
  h.update(1, 100)
  assert.equal(h.control.checked, true)
  assert.equal(h.voices.length, 0)
  h.documentEvents.emit('keydown', false)
  h.update(2, 200)
  assert.equal(h.voices.length, 0)
  h.documentEvents.emit('keydown', true)
  h.update(2, 300)
  assert.equal(h.voices.length, 0, 'the missed note stays consumed')
  h.update(3, 400)
  assert.equal(h.voices.length, 1, 'a new visible note can pop after the gesture')
})

test('a scripted checkbox activation cannot unlock sound through its browser-generated change event', t => {
  const h = setup(); t.after(h.restore)
  // Chromium emits trusted input/change events after HTMLElement.click(), but its click is untrusted.
  h.control.checked = false; h.controlEvents.emit('change', true)
  h.documentEvents.emit('click', false)
  h.control.checked = true; h.controlEvents.emit('change', true)
  h.update(1, 100)
  assert.equal(h.voices.length, 0)
  h.documentEvents.emit('click', true)
  h.update(2, 200)
  assert.equal(h.voices.length, 1)
})

test('pause, sound off, reset, and destruction immediately stop active voices', t => {
  const h = setup(); t.after(h.restore)
  h.documentEvents.emit('pointerdown', true)
  h.update(1, 100)
  h.update(2, 200, true)
  assert.equal(h.voices[0]!.immediateStops, 1)
  h.update(2, 300)
  assert.equal(h.voices.length, 1, 'a paused note never pops on resume')
  h.update(3, 400)
  h.control.checked = false; h.controlEvents.emit('change', true)
  assert.equal(h.voices[1]!.immediateStops, 1)
  h.update(4, 500)
  h.control.checked = true; h.controlEvents.emit('change', true)
  h.update(4, 600)
  assert.equal(h.voices.length, 2, 'an off-time note never pops on enabling')
  h.update(5, 700); h.sound.reset()
  assert.equal(h.voices[2]!.immediateStops, 1)
  h.update(6, 800); h.sound.destroy()
  assert.equal(h.voices[3]!.immediateStops, 1)
  assert.equal(h.controlEvents.size(), 0, 'the checkbox handler is removed on scene destruction')
  assert.equal(h.documentEvents.size(), 0)
  assert.equal(h.windowEvents.size(), 0)
})

test('backgrounding stops a tone and the first foreground frame consumes missed notes', t => {
  const h = setup(); t.after(h.restore)
  h.documentEvents.emit('pointerdown', true); h.update(1, 100)
  h.windowEvents.emit('blur', true)
  assert.equal(h.voices[0]!.immediateStops, 1)
  h.update(2, 200)
  assert.equal(h.voices.length, 1)
  h.windowEvents.emit('focus', true); h.update(3, 300); h.update(3, 400)
  assert.equal(h.voices.length, 1)
  h.update(4, 500)
  assert.equal(h.voices.length, 2)
  h.doc.hidden = true; h.documentEvents.emit('visibilitychange', true)
  assert.equal(h.voices[1]!.immediateStops, 1)
  h.doc.hidden = false; h.documentEvents.emit('visibilitychange', true)
  h.update(5, 600); h.update(5, 700)
  assert.equal(h.voices.length, 2)
})

test('an audio failure keeps the picture running and its notice clears when sound recovers', t => {
  const h = setup(); t.after(h.restore)
  h.documentEvents.emit('pointerdown', true)
  h.context.state = 'suspended'; h.update(1, 100)
  assert.equal(h.voices.length, 0)
  assert.equal(h.status.textContent, 'Sound unavailable')
  h.context.state = 'running'; h.update(1, 200)
  assert.equal(h.voices.length, 0, 'the unavailable cue stays consumed')
  h.update(2, 300)
  assert.equal(h.voices.length, 1)
  assert.equal(h.status.textContent, '')
})

function eventTarget() {
  const handlers = new Map<string, Set<(event: Event) => void>>()
  return {
    addEventListener(kind: string, fn: (event: Event) => void) {
      const listeners = handlers.get(kind) ?? new Set(); listeners.add(fn); handlers.set(kind, listeners)
    },
    removeEventListener(kind: string, fn: (event: Event) => void) { handlers.get(kind)?.delete(fn) },
    emit(kind: string, trusted: boolean) {
      for (const fn of handlers.get(kind) ?? []) fn({ isTrusted: trusted } as Event)
    },
    size: () => [...handlers.values()].reduce((sum, listeners) => sum + listeners.size, 0),
  }
}

function setup() {
  const documentEvents = eventTarget(); const controlEvents = eventTarget(); const windowEvents = eventTarget()
  const control = { ...controlEvents, checked: false }
  const status = { textContent: '' }
  const values = new Map([['1f3d9-live-sound', 'true']])
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const doc = { ...documentEvents, hidden: false, body: { dataset: {} },
    querySelector: () => control, getElementById: () => status }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { ...windowEvents,
    localStorage: { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) } } } })
  const voices: { immediateStops: number; onended: (() => void) | null }[] = []
  const context = { state: 'running', currentTime: 0,
    createOscillator() {
      const voice = { immediateStops: 0, onended: null as (() => void) | null, type: 'sine',
        frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() {},
        stop(when?: number) { if (when === undefined) this.immediateStops += 1 } }
      voices.push(voice); return voice
    },
    createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
    resume: async () => undefined,
  }
  const sound = new SceneSound({ sound: { context, destination: {} } } as never)
  sound.connect()
  const layout = nestedLayout([{ id: 1, parent_id: null, name: 'world' }])
  const camera = { width: 800, height: 600, zoom: 1, scrollX: 0, scrollY: 0 }
  const figures = new Map([[1, { sprite: { visible: true } }]])
  return { sound, control, status, context, voices, documentEvents, controlEvents, windowEvents, doc,
    updateWalk(resident: unknown, walkingLayout: ReturnType<typeof nestedLayout>, now: number) {
      sound.update(now, false, { residents: { 1: resident } } as never, figures as never, [], walkingLayout, camera as never)
    },
    update(noteId: number, now: number, paused = false) {
      const residents = { residents: { 1: { id: 1, x: 100, y: 100, walking: false, walkEventId: null,
        walkElapsed: 0, bubble: { noteId, startedAt: now } } } }
      sound.update(now, paused, residents as never, figures as never, [], layout, camera as never)
    },
    restore() {
      sound.destroy()
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else Reflect.deleteProperty(globalThis, 'window')
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
      else Reflect.deleteProperty(globalThis, 'document')
    },
  }
}
