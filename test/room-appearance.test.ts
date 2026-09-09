import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ROOM_RESIDENT_SIZE,
  ROOM_THING_SIZE,
  roomFigureStyle,
  roomTextResolution,
} from '../src/room-appearance.ts'

test('room figures use fixed integer scales for their eight-pixel drawings', () => {
  assert.equal(ROOM_RESIDENT_SIZE, 56)
  assert.equal(ROOM_THING_SIZE, 32)
  assert.deepEqual(roomFigureStyle('resident'), { scale: 7, size: 56 })
  assert.deepEqual(roomFigureStyle('thing'), { scale: 4, size: 32 })
})

test('text resolution follows measured device density', () => {
  assert.equal(roomTextResolution(1), 1)
  assert.equal(roomTextResolution(1.25), 1.25)
  assert.equal(roomTextResolution(3), 3)
  assert.equal(roomTextResolution(0), 1)
  assert.equal(roomTextResolution(Number.NaN), 1)
})
