import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { PlaceOutline, ReplayFile, Resident } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { createResidents, roomCapacity, stepResidents } from '../src/replay/simulation.ts'
import { addPresentThings, createThings, recordThingIds } from '../src/things.ts'
import { residentReservationFootprint } from '../src/resident-footprint.ts'

test('saved-day arrivals keep clear of the square census without moving existing thing spots', () => {
  const replay = JSON.parse(readFileSync(new URL('fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
  const census = ['page1', 'page2'].flatMap(page =>
    (JSON.parse(readFileSync(new URL(`fixtures/residents-presence-${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)
  const raw = JSON.parse(readFileSync(new URL('fixtures/places/place-3.json', import.meta.url), 'utf8')) as {
    place: { quiet: boolean }; things_page: { total_items: number; has_more: boolean }
    things: { id: number; name: string; place_id: number; has_drawing?: boolean }[]
  }
  const outline: PlaceOutline = {
    placeId: 3, quiet: raw.place.quiet, totalItems: raw.things_page.total_items, hasMore: raw.things_page.has_more,
    things: raw.things.map(row => ({ id: row.id, name: row.name, placeId: row.place_id, hasDrawing: row.has_drawing === true })),
  }
  const layout = nestedLayout(replay.map.places, roomCapacity(replay, census))
  const initial = createThings(replay, layout)
  let state = createResidents(replay, census, layout, initial.reservations)
  const blockers = Object.values(state.residents).filter(resident => resident.visible && resident.placeId === 3)
    .map(resident => residentReservationFootprint(`resident:${resident.id}`, resident))
  const things = addPresentThings(initial, outline, layout, recordThingIds(replay), blockers)
  const added = Object.values(things.things).filter(thing => !initial.things[thing.id])
  assert.ok(added.length > 0)
  for (const [id, spots] of Object.entries(initial.reservations)) {
    for (const spot of spots) assert.deepEqual(things.reservations[Number(id)]!.find(candidate => candidate.key === spot.key), spot)
  }
  state = Object.freeze({ ...state, reservations: things.reservations })
  let now = 0
  for (const row of replay.timeline) {
    state = stepResidents(state, [row], 0, now, layout)
    for (const resident of Object.values(state.residents)) {
      const point = resident.destinationId === 3 ? resident.destination
        : resident.placeId === 3 && !resident.walking && resident.visible ? resident : null
      if (!point) continue
      for (const thing of added) assert.ok(Math.abs(point.x - thing.x) >= 32 || Math.abs(point.y - thing.y) >= 32,
        `resident ${resident.id} overlaps current thing ${thing.id} at row ${row.change_id}`)
    }
    for (let guard = 0; state.pending && guard < 20; guard += 1) {
      now += 1_000_000
      state = stepResidents(state, [], 1_000_000, now, layout)
    }
    assert.equal(state.pending, false)
  }
})
