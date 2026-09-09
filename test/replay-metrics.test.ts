import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ReplayFile, Resident } from '../src/city/types.ts'
import { measureReplay } from '../src/replay/metrics.ts'

const replay = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
const census = ['page1', 'page2'].flatMap(page =>
  (JSON.parse(readFileSync(new URL(`./fixtures/residents-presence-${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)

test('offline fixture measurement keeps every recorded walk without playback modes', () => {
  const measured = measureReplay(replay, census)
  assert.equal(measured.walkCount, 615)
  assert.ok(measured.totalPath > 0)
  assert.ok(measured.longestPath > 0)
  assert.ok(measured.dayDurationMs > 0)
  assert.deepEqual(Object.keys(measured).sort(), ['dayDurationMs', 'longestPath', 'totalPath', 'walkCount'])
})
