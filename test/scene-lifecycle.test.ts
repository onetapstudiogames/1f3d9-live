import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { removableOnce } from '../src/scene-lifecycle.ts'

test('disposing a removable one-shot listener prevents its callback', () => {
  const events = new EventEmitter()
  let calls = 0
  const dispose = removableOnce(events, 'shutdown', () => { calls += 1 })

  assert.equal(events.listenerCount('shutdown'), 1)
  dispose()
  dispose()
  assert.equal(events.listenerCount('shutdown'), 0)
  events.emit('shutdown')
  assert.equal(calls, 0)
})

test('a removable one-shot listener runs once on shutdown and cleanup stays safe', () => {
  const events = new EventEmitter()
  let calls = 0
  const dispose = removableOnce(events, 'shutdown', () => { calls += 1 })

  events.emit('shutdown')
  events.emit('shutdown')
  dispose()
  assert.equal(calls, 1)
  assert.equal(events.listenerCount('shutdown'), 0)
})

test('replacing the activity cleanup subscription leaves only the current log subscribed', () => {
  const events = new EventEmitter()
  const destroyed: number[] = []
  let dispose = (): void => {}
  for (let log = 0; log < 25; log++) {
    dispose()
    dispose = removableOnce(events, 'shutdown', () => { destroyed.push(log) })
    assert.equal(events.listenerCount('shutdown'), 1)
  }
  events.emit('shutdown')
  assert.deepEqual(destroyed, [24])
  assert.equal(events.listenerCount('shutdown'), 0)
})
