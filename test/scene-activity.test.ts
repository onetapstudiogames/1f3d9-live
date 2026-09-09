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
  assert.deepEqual(activity.snapshot().cues.active, [])

  activity.animate([event], Date.parse(event.at), 5_000)
  assert.equal(activity.snapshot().log.entries.length, 1)
  assert.equal(activity.snapshot().cues.active[0]?.key, '1')
  assert.equal(activity.snapshot().cues.active[0]?.startedAt, 5_000)
})

test('resets presentation state without clearing the witnessed log', () => {
  const element = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(element, context)
  log.selectRoom(2)
  const activity = new SceneActivity(scene as never, log, context)
  activity.witness([event], 1_000)
  activity.animate([event], Date.parse(event.at), 5_000)

  activity.resetPresentation()

  assert.equal(activity.snapshot().log.entries.length, 1)
  assert.deepEqual(activity.snapshot().cues.active, [])
  assert.deepEqual(activity.snapshot().recent, [])
})

test('animating an unwitnessed event does not add it to the room log', () => {
  const element = { textContent: '' } as HTMLElement
  const log = new RoomActivityLine(element, context)
  log.selectRoom(2)
  const activity = new SceneActivity(scene as never, log, context)

  activity.animate([event], Date.parse(event.at), 5_000)

  assert.equal(element.textContent, '')
  assert.deepEqual(activity.snapshot().log.entries, [])
  assert.equal(activity.snapshot().cues.active[0]?.key, '1')
})
