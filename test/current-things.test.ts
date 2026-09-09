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
