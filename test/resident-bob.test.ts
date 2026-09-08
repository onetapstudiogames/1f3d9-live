import assert from 'node:assert/strict'
import test from 'node:test'

import { residentBobOffset } from '../src/resident-bob.ts'

test('awake standing residents bob gently and freeze at a fixed scene time', () => {
  const first = residentBobOffset(7, 1_000, false, false)
  assert.equal(residentBobOffset(7, 1_000, false, false), first)
  assert.notEqual(residentBobOffset(7, 1_150, false, false), first)
  assert.ok(Math.abs(first) <= 2)
})

test('idle bob has the same two-pixel height as a walk at a gentler pace', () => {
  assert.equal(residentBobOffset(0, 450, false, false), 2)
  assert.equal(residentBobOffset(0, 1_350, false, false), -2)
  assert.ok(Math.abs(residentBobOffset(0, 1_800, false, false)) < 1e-12)
  assert.notEqual(residentBobOffset(1, 450, false, false), residentBobOffset(0, 450, false, false))
})

test('walking keeps its existing bob and hidden sleepers stay still', () => {
  assert.equal(residentBobOffset(7, 90 * Math.PI / 2, true, false), 2)
  assert.equal(residentBobOffset(7, 1_000, false, true), 0)
  assert.equal(residentBobOffset(7, 1_000, true, true), 0)
})
