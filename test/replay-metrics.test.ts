import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ReplayFile, Resident } from '../src/city/types.ts'
import { measureReplay } from '../src/replay/metrics.ts'

const replay = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
const census = ['page1', 'page2'].flatMap(page =>
  (JSON.parse(readFileSync(new URL(`./fixtures/residents-presence-${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)

test('saved day duration stays pinned with full-size resident world geometry', () => {
  const measured = [60, 120, 300].map(speed => measureReplay(replay, census, speed))
  assert.deepEqual(measured.map(row => row.walkCount), [615, 615, 615])
  // Larger 72px world slots change route distances; the speech ceiling still shortens slow holds without removing walks.
  assert.deepEqual(measured.map(row => Number((row.dayDurationMs / 60_000).toFixed(2))), [108.45, 56.48, 25.22])
  assert.ok(measured[1]!.dayDurationMs < 60 * 60_000)
  assert.ok(measured[2]!.dayDurationMs < measured[1]!.dayDurationMs / 2)
})
