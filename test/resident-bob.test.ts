import assert from 'node:assert/strict'
import test from 'node:test'

import { residentBobOffset } from '../src/resident-bob.ts'

test('awake standing residents bob gently and freeze at a fixed scene time', () => {
  const first = residentBobOffset(7, 1_000, false, false)
  assert.equal(residentBobOffset(7, 1_000, false, false), first)
  assert.notEqual(residentBobOffset(7, 1_150, false, false), first)
  assert.ok(Math.abs(first) <= 0.75)
})

test('walking keeps its existing stronger bob and sleeping stays still', () => {
  assert.equal(residentBobOffset(7, 90 * Math.PI / 2, true, false), 2)
  assert.equal(residentBobOffset(7, 1_000, false, true), 0)
  assert.equal(residentBobOffset(7, 1_000, true, true), 0)
})
