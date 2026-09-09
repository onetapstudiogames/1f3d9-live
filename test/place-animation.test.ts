import test from 'node:test'
import assert from 'node:assert/strict'
import { nestedLayout } from '../src/ground/nested.ts'
import {
  contentHiddenRooms, placeAnimation, stepPlaceAnimations,
} from '../src/place-animation.ts'

test('place animations use fixed durations and malformed start times stay finite', () => {
  const founding = placeAnimation('founding', 2, 'c1', 100)
  assert.equal(founding.duration, 3_200)
  assert.equal(placeAnimation('renaming', 2, 'c3', 0).duration, 700)
  assert.equal(placeAnimation('renaming', 2, 'c4', Number.NaN).startedAt, 0)
})

test('active animations expire and incoming change ids are deduplicated', () => {
  const old = placeAnimation('renaming', 2, 'same', 0)
  const fresh = placeAnimation('founding', 3, 'new', 100)
  assert.deepEqual(stepPlaceAnimations([old], [old, fresh], 100), [old, fresh])
  assert.deepEqual(stepPlaceAnimations([old], [old], 10_000), [old])
  assert.deepEqual(stepPlaceAnimations([old], [], 10_000), [])
})

test('a founding and renaming at the same moment are both kept for one place', () => {
  const founding = placeAnimation('founding', 2, 'found', 0)
  const renaming = placeAnimation('renaming', 2, 'rename', 0)
  const stepped = stepPlaceAnimations([], [founding, renaming], 0)
  assert.equal(stepped[0], founding)
  assert.equal(stepped[1]?.startedAt, founding.duration)
})

test('founding animation hides the room content and all descendants', () => {
  const layout = nestedLayout([
    { id: 1, parent_id: null }, { id: 2, parent_id: 1, quiet: true },
    { id: 3, parent_id: 2 }, { id: 4, parent_id: 1 },
  ])
  const active = [placeAnimation('founding', 2, 'c1', 0)]
  assert.deepEqual([...contentHiddenRooms(layout, active)].sort(), [2, 3])
})

