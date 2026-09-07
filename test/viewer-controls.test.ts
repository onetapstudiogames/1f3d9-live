import assert from 'node:assert/strict'
import test from 'node:test'

import { followChoices } from '../src/follow.ts'
import { readShowSleepers, saveShowSleepers } from '../src/preferences.ts'
import type { ResidentState } from '../src/replay/simulation.ts'

const resident = (id: number, handle: string, visible = true): ResidentState => ({
  id, handle, joinedAt: null, sparkle: null, placeId: 1, x: 0, y: 0, flipX: false,
  walking: false, visible, bubble: null, queue: [], path: [], walkElapsed: 0,
  walkDuration: 0, destinationId: null, destination: null, walkEventId: null, transferUntil: null,
})

test('sleepers are hidden by default and a saved choice is read safely', () => {
  assert.equal(readShowSleepers(null), false)
  assert.equal(readShowSleepers({ getItem: () => null }), false)
  assert.equal(readShowSleepers({ getItem: () => 'true' }), true)
  assert.equal(readShowSleepers({ getItem: () => 'false' }), false)
  assert.equal(readShowSleepers({ getItem: () => { throw new Error('blocked') } }), false)
  assert.equal(saveShowSleepers(null, true), false)
  let saved = ''
  assert.equal(saveShowSleepers({ setItem: (_key, value) => { saved = value } }, true), true)
  assert.equal(saved, 'true')
  assert.equal(saveShowSleepers({ setItem: () => { throw new Error('full') } }, false), false)
})

test('follow choices are named, visible, sorted, searchable, and exclude hidden sleepers', () => {
  const residents = [resident(2, 'Zulu'), resident(1, 'alpha'), resident(3, 'resident:3'), resident(4, 'Beta', false)]
  const sleepers = new Set([2])
  assert.deepEqual(followChoices(residents, sleepers, false, ''), [{ id: 1, name: 'alpha' }])
  assert.deepEqual(followChoices(residents, sleepers, true, ''), [{ id: 1, name: 'alpha' }, { id: 2, name: 'Zulu' }])
  assert.deepEqual(followChoices(residents, sleepers, true, 'zul'), [{ id: 2, name: 'Zulu' }])
  assert.deepEqual(followChoices(residents, sleepers, true, 'missing'), [])
})
