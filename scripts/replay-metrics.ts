import { readFileSync } from 'node:fs'

import type { ReplayFile, Resident } from '../src/city/types.ts'
import { measureReplay } from '../src/replay/metrics.ts'

const fixture = (name: string): URL => new URL(`../test/fixtures/${name}`, import.meta.url)
const replay = JSON.parse(readFileSync(fixture('replay-24h.json'), 'utf8')) as ReplayFile
const census = ['page1', 'page2'].flatMap(page =>
  (JSON.parse(readFileSync(fixture(`residents-presence-${page}.json`), 'utf8')) as { residents: Resident[] }).residents)
const metrics = measureReplay(replay, census)

console.log(`walks: ${String(metrics.walkCount)}`)
console.log(`path pixels: total ${String(metrics.totalPath)}, longest ${String(metrics.longestPath)}`)
console.log(`fixture duration: ${(metrics.dayDurationMs / 60_000).toFixed(2)} minutes`)
