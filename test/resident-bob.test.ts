import assert from 'node:assert/strict'
import test from 'node:test'

import { residentBobOffset } from '../src/resident-bob.ts'

test('awake standing residents bob gently and freeze at a fixed scene time', () => {
  const first = residentBobOffset(7, 1_000, false)
  assert.equal(residentBobOffset(7, 1_000, false), first)
  assert.notEqual(residentBobOffset(7, 1_150, false), first)
  assert.ok(Math.abs(first) <= 2)
})

test('idle bob has the same two-pixel height as a walk at a gentler pace', () => {
  assert.equal(residentBobOffset(0, 450, false), 2)
  assert.equal(residentBobOffset(0, 1_350, false), -2)
  assert.ok(Math.abs(residentBobOffset(0, 1_800, false)) < 1e-12)
  assert.notEqual(residentBobOffset(1, 450, false), residentBobOffset(0, 450, false))
})

test('walking keeps its existing bob', () => {
  assert.equal(residentBobOffset(7, 90 * Math.PI / 2, true), 2)
})
