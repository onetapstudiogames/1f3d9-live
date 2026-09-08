import assert from 'node:assert/strict'
import test from 'node:test'
import { clearThingLabels } from '../src/thing-labels.ts'

test('nearby names yield space to each other and to resident portraits', () => {
  const labels = [{ id: 1, x: 0, y: 0 }, { id: 2, x: 48, y: 0 }, { id: 3, x: 240, y: 0 }]
  assert.deepEqual([...clearThingLabels(labels, [])], [1, 3])
  assert.deepEqual([...clearThingLabels(labels, [{ x: 240, y: 0 }])], [1])
  assert.deepEqual([...clearThingLabels(labels.map(row => ({ ...row, x: row.x * 3 })), [])], [1, 2, 3])
})
