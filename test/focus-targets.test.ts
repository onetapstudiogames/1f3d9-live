import test from 'node:test'
import assert from 'node:assert/strict'
import { currentFocusTargets } from '../src/focus-targets.ts'
import { nestedLayout } from '../src/ground/nested.ts'

test('Focus includes current visible effects and excludes hidden or inactive objects', () => {
  const layout = nestedLayout([{ id: 1, parent_id: null, name: 'world', quiet: false }])
  const things = { 1: { id: 1, placeId: 1, name: 'lamp', x: 20, y: 20, visible: true,
    effect: { kind: 'glow' as const, startedAt: 100, expiresAt: 900 } } }
  const targets = currentFocusTargets({}, things, [], layout, () => true, new Set(), new Set())
  assert.equal(targets[0]!.key, 'thing:1')
  assert.equal(targets[0]!.rank, 5)
  assert.deepEqual(currentFocusTargets({}, things, [], layout, () => true, new Set([1]), new Set()), [])
  assert.deepEqual(currentFocusTargets({}, { 1: { ...things[1], effect: null } }, [], layout, () => true, new Set(), new Set()), [])
})
