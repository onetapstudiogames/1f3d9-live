import { readFileSync } from 'node:fs'

import type { ReplayFile, Resident } from '../src/city/types.ts'
import { measureReplay } from '../src/replay/metrics.ts'

const fixture = (name: string): URL => new URL(`../test/fixtures/${name}`, import.meta.url)
const replay = JSON.parse(readFileSync(fixture('replay-24h.json'), 'utf8')) as ReplayFile
const census = ['page1', 'page2'].flatMap(page =>
  (JSON.parse(readFileSync(fixture(`residents-presence-${page}.json`), 'utf8')) as { residents: Resident[] }).residents)
const rows = [60, 120, 300].map(speed => measureReplay(replay, census, speed))
const paths = rows.find(row => row.speed === 120)!

console.log(`walks: ${String(paths.walkCount)}`)
console.log(`path pixels: total ${String(paths.totalPath)}, longest ${String(paths.longestPath)}`)
for (const row of rows) console.log(`${String(row.speed)}x day: ${(row.dayDurationMs / 60_000).toFixed(2)} minutes`)
