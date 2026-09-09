import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ReplayFile, Resident } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { createResidents, stepResidents } from '../src/replay/simulation.ts'
import { recordedRoomCapacity } from './helpers/recorded-scene.ts'
import { createdThing, createThings, stepThings, usedThing } from '../src/things.ts'
import { roomsToDraw } from '../src/room-art.ts'

const fixture = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const replay = JSON.parse(fixture('./fixtures/replay-24h.json')) as ReplayFile
const census = ['page1', 'page2'].flatMap(page =>
  (JSON.parse(fixture(`./fixtures/residents-presence-${page}.json`)) as { residents: Resident[] }).residents)

test('saved thing metadata and drawings match the public fixture tree', () => {
  const floorStarts = Object.entries(replay.start).flatMap(([key, start]) => {
    const match = /^thing:(\d+)$/.exec(key)
    return match && start && start.place_id !== null ? [{ id: Number(match[1]), placeId: start.place_id }] : []
  })
  assert.equal(Object.keys(replay.start).filter(key => key.startsWith('thing:')).length, 70)
  assert.equal(floorStarts.length, 19)
  assert.equal(70 - floorStarts.length, 51)

  for (const { id } of floorStarts) {
    const saved = fixture(`./fixtures/things/thing-${String(id)}.json`)
    assert.equal(saved, fixture(`../public/fixtures/things/thing-${String(id)}.json`), `thing ${String(id)} bytes`)
    const record = (JSON.parse(saved) as { thing: { id: number; name: string } }).thing
    assert.equal(record.id, id)
    assert.ok(record.name.trim().length > 0)
  }

  for (const id of [1536, 2534]) {
    const saved = fixture(`./fixtures/thing-${String(id)}.json`)
    assert.equal(saved, fixture(`../public/fixtures/drawings/thing-${String(id)}.json`), `drawing ${String(id)} bytes`)
    const drawing = JSON.parse(saved) as { type: string; id: number; state: string; drawing: { palette: string[]; indices: (number | null)[] } }
    assert.equal(drawing.type, 'thing')
    assert.equal(drawing.id, id)
    assert.equal(drawing.state, 'complete')
    assert.equal(drawing.drawing.indices.length, 64)
    assert.ok(drawing.drawing.palette.every(color => /^#[0-9a-fA-F]{6}$/.test(color)))
    assert.ok(drawing.drawing.indices.every(index => index === null || Number.isInteger(index) && index >= 0 && index < drawing.drawing.palette.length))
  }
})

test('saved replay places only recorded floor things and replays names and uses', () => {
  const layout = nestedLayout(replay.map.places, recordedRoomCapacity(replay, census))
  let things = createThings(replay, layout)
  assert.equal(Object.keys(things.things).length, 19)

  const created = replay.timeline.flatMap(row => {
    const parsed = createdThing(row)
    return parsed ? [parsed] : []
  })
  assert.equal(created.length, 9)
  assert.ok(created.every(item => item.name !== null && item.name.length > 0))
  assert.equal(new Set(created.map(item => item.name)).size, 9)

  const uses = replay.timeline.filter(row => usedThing(row) !== null)
  assert.equal(uses.length, 5)
  assert.ok(uses.every(row => row.detail.status === 'noop'))
  for (const row of replay.timeline) {
    things = stepThings(things, [row], Number(row.change_id))
    const usedId = usedThing(row)
    if (usedId !== null) {
      assert.equal(things.things[usedId]?.placeId, row.detail.place_id)
      assert.equal(things.things[usedId]?.effect?.kind, 'glow')
    }
  }
  assert.equal(Object.keys(things.things).length, 28)
})

test('saved residents keep clear of fixed thing reservations through the replay', () => {
  const layout = nestedLayout(replay.map.places, recordedRoomCapacity(replay, census))
  let things = createThings(replay, layout)
  let residents = createResidents(replay, census, layout, things.reservations)
  const visibleRooms = new Set(roomsToDraw(layout).filter(room => !room.quiet).map(room => room.id))
  const withoutThings = createResidents(replay, census, layout)
  assert.equal(Object.values(residents.residents).filter(resident => resident.visible).length,
    Object.values(withoutThings.residents).filter(resident => resident.visible).length)
  const fixed = new Map<number, readonly [number, number]>()

  const checkClearance = (): void => {
    assert.ok(!residents.issues.some(issue => issue.includes('no free spot')))
    const held = Object.values(residents.residents).flatMap(resident => {
      if (!resident.walking && resident.placeId !== null && visibleRooms.has(resident.placeId)) {
        assert.ok(resident.visible, `resident ${resident.id} disappeared from a visible room`)
      }
      const placeId = resident.walking ? resident.destinationId : resident.placeId
      const point = resident.walking ? resident.destination : resident
      return placeId !== null && point && visibleRooms.has(placeId) ? [{ id: resident.id, placeId, x: point.x, y: point.y }] : []
    })
    for (let index = 0; index < held.length; index += 1) {
      const left = held[index]!
      for (const right of held.slice(index + 1).filter(item => item.placeId === left.placeId)) {
        assert.ok(Math.abs(left.x - right.x) >= 48 || Math.abs(left.y - right.y) >= 48,
          `residents ${left.id} and ${right.id} share a standing spot`)
      }
    }
    for (const thing of Object.values(things.things)) {
      const previous = fixed.get(thing.id)
      if (previous) assert.deepEqual([thing.x, thing.y], previous, `thing ${String(thing.id)} moved without a recorded floor move`)
      else fixed.set(thing.id, [thing.x, thing.y])
      for (const resident of Object.values(residents.residents)) {
        const points = [!resident.walking && resident.placeId === thing.placeId ? { x: resident.x, y: resident.y } : null,
          resident.destinationId === thing.placeId ? resident.destination : null].filter(point => point !== null)
        for (const point of points) {
          assert.ok(Math.abs(point.x - thing.x) >= 48 || Math.abs(point.y - thing.y) >= 48,
            `resident ${String(resident.id)} overlaps thing ${String(thing.id)} in room ${String(thing.placeId)}`)
        }
      }
    }
  }

  let now = 0
  checkClearance()
  for (const row of replay.timeline) {
    now += 1
    things = stepThings(things, [row], now)
    residents = stepResidents(residents, [row], 0, now, layout)
    checkClearance()
    for (let guard = 0; residents.pending && guard < 20; guard += 1) {
      now += 2_000
      residents = stepResidents(residents, [], 2_000, now, layout)
      checkClearance()
    }
  }
  assert.equal(Object.keys(things.things).length, 28)
})
