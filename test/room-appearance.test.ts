import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ROOM_NAME_FONT_SIZE,
  ROOM_RESIDENT_SCALE,
  ROOM_RESIDENT_SIZE,
  ROOM_THING_SCALE,
  ROOM_THING_SIZE,
  roomFigureStyle,
  roomNameStyle,
  roomTextResolution,
} from '../src/room-appearance.ts'

test('room figures use fixed integer scales for their eight-pixel drawings', () => {
  assert.equal(ROOM_RESIDENT_SCALE, 7)
  assert.equal(ROOM_RESIDENT_SIZE, 56)
  assert.equal(ROOM_THING_SCALE, 4)
  assert.equal(ROOM_THING_SIZE, 32)
  assert.deepEqual(roomFigureStyle('resident'), { scale: 7, size: 56 })
  assert.deepEqual(roomFigureStyle('thing'), { scale: 4, size: 32 })
})

test('room names stay thirteen pixels while text resolution follows measured device density', () => {
  assert.equal(ROOM_NAME_FONT_SIZE, 13)
  assert.equal(roomTextResolution(1), 1)
  assert.equal(roomTextResolution(1.25), 1.25)
  assert.equal(roomTextResolution(3), 3)
  assert.equal(roomTextResolution(0), 1)
  assert.equal(roomTextResolution(Number.NaN), 1)
  assert.deepEqual(roomNameStyle(2.5), { fontSize: 13, resolution: 2.5, paddingX: 4, paddingY: 2 })
})

test('moving between display densities changes only name texture resolution', () => {
  const styles = [1, 2, 3, 1].map(roomNameStyle)
  assert.deepEqual(styles.map(style => style.resolution), [1, 2, 3, 1])
  assert.ok(styles.every(style => style.fontSize === ROOM_NAME_FONT_SIZE && style.paddingX === 4 && style.paddingY === 2))
})
