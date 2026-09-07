import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ReplayFile, Resident } from '../src/city/types.ts'
import { nestedLayout, type Point } from '../src/ground/nested.ts'
import { createResidents, roomCapacity, stepResidents } from '../src/replay/simulation.ts'
import { createThings } from '../src/things.ts'

// For an axis-aligned walk, both 32-pixel squares must stay separated on at least
// one axis. This also catches corners that a centre-distance-only check misses.
function squareClearance(point: Point, from: Point, to: Point): number {
  const x = Math.max(Math.min(from.x, to.x), Math.min(Math.max(from.x, to.x), point.x))
  const y = Math.max(Math.min(from.y, to.y), Math.min(Math.max(from.y, to.y), point.y))
  return Math.max(Math.abs(point.x - x), Math.abs(point.y - y))
}

test('every saved-day walk clears figures standing when its route is planned', () => {
  const replay = JSON.parse(readFileSync(new URL('fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
  const census = ['page1', 'page2'].flatMap(page =>
    (JSON.parse(readFileSync(new URL(`fixtures/residents-presence-${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)
  const layout = nestedLayout(replay.map.places, roomCapacity(replay, census))
  let state = createResidents(replay, census, layout, createThings(replay, layout).reservations)
  let now = 0
  let walks = 0
  for (const row of replay.timeline) {
    const before = state
    state = stepResidents(state, [row], 0, now, layout)
    for (const walker of Object.values(state.residents).filter(resident => resident.walking)) {
      walks += 1
      for (const standing of Object.values(before.residents).filter(resident => resident.id !== walker.id && !resident.walking && resident.visible)) {
        for (let index = 1; index < walker.path.length; index += 1) {
          const from = walker.path[index - 1]!
          const to = walker.path[index]!
          assert.ok(from.x === to.x || from.y === to.y)
          assert.ok(squareClearance(standing, from, to) >= 32,
            `walk ${row.change_id} crosses standing resident ${standing.id}`)
        }
      }
    }
    // Settle this row before the next one; the full timed day is checked separately.
    for (let guard = 0; state.pending && guard < 20; guard += 1) {
      now += 1_000_000
      state = stepResidents(state, [], 1_000_000, now, layout)
    }
    assert.equal(state.pending, false)
  }
  assert.equal(walks, 615)
})
