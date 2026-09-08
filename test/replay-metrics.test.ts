import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ReplayFile, Resident } from '../src/city/types.ts'
import { measureReplay } from '../src/replay/metrics.ts'

const replay = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
const census = ['page1', 'page2'].flatMap(page =>
  (JSON.parse(readFileSync(new URL(`./fixtures/residents-presence-${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)

test('saved day duration stays pinned for fast-forward and the original benchmark speeds', () => {
  const measured = [60, 120, 300].map(speed => measureReplay(replay, census, speed))
  assert.deepEqual(measured.map(row => row.walkCount), [615, 615, 615])
  assert.deepEqual(measured.map(row => Number((row.dayDurationMs / 60_000).toFixed(2))), [110.97, 56.1, 25.29])
  assert.ok(measured[1]!.dayDurationMs < 60 * 60_000)
  assert.ok(measured[2]!.dayDurationMs < measured[1]!.dayDurationMs / 2)
})
