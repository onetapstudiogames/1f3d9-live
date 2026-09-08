import assert from 'node:assert/strict'
import test from 'node:test'

import { positionBubbleCard } from '../src/bubble-position.ts'

test('a bubble prefers above its speaker and stays inside horizontal gutters', () => {
  assert.deepEqual(positionBubbleCard({ x: 20, y: 160 }, { width: 120, height: 60 },
    { width: 320, height: 240 }, 48), { x: 8, y: 66, tailX: 20, tailY: 126, side: 'above' })
  assert.deepEqual(positionBubbleCard({ x: 310, y: 160 }, { width: 120, height: 60 },
    { width: 320, height: 240 }, 48).x, 192)
})

test('a bubble moves below when above does not fit', () => {
  assert.deepEqual(positionBubbleCard({ x: 160, y: 40 }, { width: 120, height: 60 },
    { width: 320, height: 240 }, 48), { x: 100, y: 88, tailX: 160, tailY: 88, side: 'below' })
})

test('a bubble top-clamps when neither vertical side fits', () => {
  const position = positionBubbleCard({ x: 160, y: 70 }, { width: 120, height: 180 },
    { width: 320, height: 200 }, 48)
  assert.deepEqual(position, { x: 100, y: 8, tailX: 160, tailY: 8, side: 'below' })
})

test('the tail remains inset on the card edge when the speaker is beyond a clamped card', () => {
  const left = positionBubbleCard({ x: 0, y: 160 }, { width: 120, height: 60 },
    { width: 320, height: 240 }, 48)
  const right = positionBubbleCard({ x: 320, y: 160 }, { width: 120, height: 60 },
    { width: 320, height: 240 }, 48)
  assert.equal(left.tailX, 16)
  assert.equal(right.tailX, 304)
})

test('a room-sized page remains within the room after resize', () => {
  const position = positionBubbleCard({ x: 160, y: 80 }, { width: 120, height: 224 },
    { width: 320, height: 240 }, 48)
  assert.equal(position.y, 8)
  assert.ok(position.y + 224 <= 240)
})
