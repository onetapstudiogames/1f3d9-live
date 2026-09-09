import assert from 'node:assert/strict'
import test from 'node:test'
import { OPTIONAL_OUTLINE_ISSUE, readIssuesAfterCycle, readOptionalOutline } from '../src/read-issues.ts'

test('an optional outline returns its successful value without an issue', async () => {
  const outline = { placeId: 7 }
  assert.deepEqual(await readOptionalOutline(7, async id => ({ ...outline, placeId: id })),
    { outline, issue: null })
})

test('a missing optional outline remains a quiet null result', async () => {
  assert.deepEqual(await readOptionalOutline(7, async () => null), { outline: null, issue: null })
})

test('a rejected optional outline becomes one muted issue without rejecting startup', async () => {
  const result = await readOptionalOutline(7, async () => { throw new Error('network unavailable') })
  assert.deepEqual(result, { outline: null, issue: OPTIONAL_OUTLINE_ISSUE })
})

test('a successful read cycle replaces old transient issues with only this cycle issues', () => {
  assert.deepEqual(readIssuesAfterCycle(['old failure'], ['outline missing', 'outline missing'], true), ['outline missing'])
  assert.deepEqual(readIssuesAfterCycle(['old failure'], [], true), [])
})

test('a failed read cycle preserves the issues from the last successful picture', () => {
  const previous = Object.freeze(['last complete picture issue'])
  assert.strictEqual(readIssuesAfterCycle(previous, ['partial-cycle issue'], false), previous)
})
