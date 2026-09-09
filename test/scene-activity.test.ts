import assert from 'node:assert/strict'
import test from 'node:test'
import type { ActivityContext } from '../src/activity.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import { RoomActivityLine } from '../src/scenes/RoomActivityLine.ts'
import { SceneActivity } from '../src/scenes/SceneActivity.ts'

const context: ActivityContext = {
  resident: name => ({ type: 'resident', id: 1, name, hasDrawing: false }),
  place: id => ({ id, name: `room ${id}`, parentId: null, quiet: false, hasDrawing: false }),
  roomName: id => `room ${id}`,
}

const event: ReplayEvent = {
  actor: 'author', at: '2099-01-01T00:00:00.000Z', change_id: '1', event_id: 1,
  kind: 'note', detail: { note_id: 1, place_id: 2 }, line: 'hello', line_cut: false,
}

const scene = { add: { graphics: () => ({ setDepth() { return this }, clear() {}, fillStyle() {}, fillRect() {}, destroy() {} }) } }

test('logs a witnessed event once before its independently scheduled cue starts', () => {
  const element = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(element, context)
  log.selectRoom(2)
  const activity = new SceneActivity(scene as never, log, context)

  assert.equal(activity.witness([event], 1_000).length, 1)
  assert.equal(activity.witness([event], 1_000).length, 0)
  assert.equal(element.textContent, 'author in room 2: hello')
  assert.equal(activity.animate([event], Date.parse(event.at), 5_000)[0]?.key, '1')
  assert.equal(element.textContent, 'author in room 2: hello')
})

test('resets presentation state without clearing the witnessed log', () => {
  const element = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(element, context)
  log.selectRoom(2)
  const activity = new SceneActivity(scene as never, log, context)
  activity.witness([event], 1_000)
  activity.animate([event], Date.parse(event.at), 5_000)

  activity.resetPresentation()

  assert.equal(element.textContent, 'author in room 2: hello')
})

test('animating an unwitnessed event does not add it to the room log', () => {
  const element = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(element, context)
  log.selectRoom(2)
  const activity = new SceneActivity(scene as never, log, context)

  activity.animate([event], Date.parse(event.at), 5_000)

  assert.equal(element.textContent, '')
})

test('caption DOM belongs only to witnessed visible-room actions and clears with presentation', t => {
  class Element {
    className = ''; dataset: Record<string, string> = {}; textContent = ''; children: Element[] = []
    style: Record<string, string> = { display: '' }; parent: Element | null = null
    append(child: Element): void { child.parent = this; this.children.push(child) }
    remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this) }
    getBoundingClientRect(): DOMRect { return { left: 0, top: 0, width: 0, height: 0 } as DOMRect }
  }
  const previous = globalThis.document
  const layer = new Element()
  const fake = {
    createElement: () => new Element(),
    querySelector: (selector: string) => selector === '#speech-layer' ? layer : null,
    querySelectorAll: (selector: string) => layer.children.filter(child => selector.includes(`.${child.className}`)),
  } as unknown as Document
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fake })
  t.after(() => Object.defineProperty(globalThis, 'document', { configurable: true, value: previous }))
  const action: ReplayEvent = { ...event, change_id: '2', kind: 'action', line: undefined,
    detail: { action: 'use', status: 'applied', thing_id: 4, place_id: 2 } }
  const rich: ActivityContext = { ...context, actorRoom: () => 2,
    thing: () => ({ entity: { type: 'thing', id: 4, name: 'brass bell', hasDrawing: true }, placeId: 2 }) }
  const log = new RoomActivityLine({ textContent: '' } as HTMLElement, rich); log.selectRoom(2)
  const activity = new SceneActivity(scene as never, log, rich)
  const resident = { id: 1, x: 100, y: 100, visible: true }

  activity.animate([action], Date.parse(action.at), 0)
  activity.updateCaptions({ 1: resident } as never, { width: 300, height: 250 }, 0)
  assert.equal(layer.children.length, 0)
  const offRoom = { ...action, change_id: '3', detail: { ...action.detail, place_id: 3 } }
  activity.witness([offRoom], 1_000, rich, 5)
  activity.updateCaptions({ 1: resident } as never, { width: 300, height: 250 }, 5)
  assert.equal(layer.children.length, 0)
  activity.witness([action], 1_000, rich, 10)
  activity.updateCaptions({ 1: resident } as never, { width: 300, height: 250 }, 10)
  assert.equal(layer.children[0]?.textContent, 'used a brass bell')
  activity.updateCaptions({ 1: { ...resident, visible: false } } as never, { width: 300, height: 250 }, 11)
  assert.equal(layer.children.length, 0)
  activity.updateCaptions({ 1: resident } as never, { width: 300, height: 250 }, 12)
  assert.equal(layer.children.length, 1)
  activity.resetPresentation()
  assert.equal(layer.children.length, 0)
})
