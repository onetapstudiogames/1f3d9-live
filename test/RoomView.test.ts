import assert from 'node:assert/strict'
import test from 'node:test'
import { refreshTextResolution } from '../src/resident-overlays.ts'

test('room name text refreshes once when device density changes', () => {
  const calls: number[] = []
  const text = {
    style: { resolution: 1 },
    setResolution(value: number) { calls.push(value); this.style.resolution = value },
  }

  refreshTextResolution(text, 2.5)
  refreshTextResolution(text, 2.5)

  assert.equal(text.style.resolution, 2.5)
  assert.deepEqual(calls, [2.5])
})
