import assert from 'node:assert/strict'
import test from 'node:test'
import { refreshPresentThings } from '../src/current-things.ts'
import type { PlaceOutline, ReplayPlace } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import type { ThingSimulation, ThingState } from '../src/things.ts'

const places: readonly ReplayPlace[] = [
  { id: 1, name: 'world', parent_id: null, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 2, name: 'room', parent_id: 1, owner: null, owner_id: null, quiet: false, has_drawing: false },
]
const layout = nestedLayout(places, { 1: 3, 2: 3 })
const thing = (id: number, placeId: number, name: string): ThingState =>
  ({ id, placeId, name, x: 100 + id, y: 100, visible: true, effect: null })
const state = (things: readonly ThingState[]): ThingSimulation => Object.freeze({
  things: Object.freeze(Object.fromEntries(things.map(row => [row.id, Object.freeze(row)]))),
  reservations: Object.freeze(Object.fromEntries(things.map(row => [row.placeId,
    Object.freeze(things.filter(item => item.placeId === row.placeId).map(item => Object.freeze({
      key: `thing:${item.id}`, kind: 'thing' as const, x: item.x - 16, y: item.y - 16, width: 32, height: 32,
    })))]))),
  issues: Object.freeze([]), queue: Object.freeze([]), pending: false,
})
const outline = (things: PlaceOutline['things'], hasMore = false): PlaceOutline =>
  ({ placeId: 2, quiet: false, things, totalItems: things.length, hasMore })

test('complete current outline removes missing room things and their reservations', () => {
  const before = state([thing(1, 2, 'old'), thing(9, 1, 'elsewhere')])
  const next = refreshPresentThings(before, outline([]), layout, [])
  assert.equal(next.things[1], undefined)
  assert.equal(next.reservations[2]?.some(row => row.key === 'thing:1'), false)
  assert.strictEqual(next.things[9], before.things[9])
})

test('listed current things update names without losing their presentation', () => {
  const before = state([thing(1, 2, 'old')])
  const next = refreshPresentThings(before, outline([{ id: 1, name: 'new', placeId: 2, hasDrawing: false }]), layout, [])
  assert.equal(next.things[1]!.name, 'new')
  assert.equal(next.things[1]!.x, before.things[1]!.x)
})

test('partial current outlines preserve room things not present on the page', () => {
  const before = state([thing(1, 2, 'old')])
  const next = refreshPresentThings(before, outline([], true), layout, [])
  assert.strictEqual(next.things[1], before.things[1])
})

test('listed things that moved rooms are re-seated at a fresh room spot', () => {
  const before = state([thing(1, 1, 'old')])
  const next = refreshPresentThings(before, outline([{ id: 1, name: 'new', placeId: 2, hasDrawing: false }]), layout, [])
  assert.equal(next.things[1]!.placeId, 2)
  assert.equal(next.things[1]!.name, 'new')
  assert.equal(next.reservations[1]?.some(row => row.key === 'thing:1'), false)
  assert.equal(next.reservations[2]?.some(row => row.key === 'thing:1'), true)
})

test('quiet outlines cannot remove or rename retained things', () => {
  const before = state([thing(1, 2, 'old')])
  const next = refreshPresentThings(before, { ...outline([{ id: 1, name: 'secret', placeId: 2, hasDrawing: false }]), quiet: true }, layout, [])
  assert.strictEqual(next, before)
  assert.equal(next.things[1]!.name, 'old')
  const quietLayout = nestedLayout([{ ...places[0]!, quiet: true }, places[1]!], { 1: 3, 2: 3 })
  assert.strictEqual(refreshPresentThings(before, outline([]), quietLayout, []), before)
})

test('all ten listed things remain room members when the source standing band has only three spots', () => {
  const ids = [1481, 1487, 1492, 1501, 1508, 1513, 1519, 1526, 1532, 1539]
  const rows = ids.map((id, index) => ({ id, name: `shelf thing ${index + 1}`, placeId: 2, hasDrawing: false }))
  const small = { ...layout, rooms: { ...layout.rooms,
    2: { ...layout.rooms[2]!, standing: { ...layout.rooms[2]!.standing, width: 120, height: 64 } },
  } }
  const next = refreshPresentThings(state([]), outline(rows), small, [])

  assert.deepEqual(Object.keys(next.things).map(Number).sort((a, b) => a - b), ids)
  assert.ok((next.reservations[2]?.length ?? 0) < ids.length)
})

test('a complete bounded outline keeps all 200 listed things as room members', () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({
    id: 10_000 + index, name: `bounded thing ${index + 1}`, placeId: 2, hasDrawing: false,
  }))
  const next = refreshPresentThings(state([]), outline(rows), layout, [])

  assert.equal(Object.keys(next.things).length, 200)
  assert.ok(rows.every(row => next.things[row.id]?.placeId === 2))
})

test('successive partial pages favor the current rows and never retain more than 200 room things', () => {
  const firstRows = Array.from({ length: 200 }, (_, index) => ({
    id: 20_000 + index, name: `old thing ${index + 1}`, placeId: 2, hasDrawing: false,
  }))
  const secondRows = Array.from({ length: 200 }, (_, index) => ({
    id: 30_000 + index, name: `current thing ${index + 1}`, placeId: 2, hasDrawing: false,
  }))
  const first = refreshPresentThings(state([]), outline(firstRows, true), layout, [])
  const second = refreshPresentThings(first, outline(secondRows, true), layout, [])
  const roomThings = Object.values(second.things).filter(row => row.placeId === 2)

  assert.equal(roomThings.length, 200)
  assert.ok(secondRows.every(row => second.things[row.id]))
  assert.ok(firstRows.every(row => !second.things[row.id]))
})
