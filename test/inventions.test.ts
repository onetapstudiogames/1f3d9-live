import assert from 'node:assert/strict'
import test from 'node:test'

import { bulbCells, inventionDuration, inventionFor, stepInventions, type InventionState } from '../src/inventions.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import type { ResidentState, Simulation } from '../src/replay/simulation.ts'

const event = (kind: string, actor: string | null, detail: Record<string, unknown>): ReplayEvent => ({
  actor, at: '2026-09-02T12:00:00.000Z', change_id: '84913', event_id: 84913, kind, detail,
})

const resident: ResidentState = Object.freeze({ id: 7, handle: 'ada', joinedAt: null, sparkle: null,
  placeId: 3, x: 120, y: 80, flipX: false, walking: false, visible: true, bubble: null, queue: [], path: [],
  walkElapsed: 0, walkDuration: 0, destinationId: null, destination: null, walkEventId: null, transferUntil: null })
const residents: Simulation = Object.freeze({ residents: Object.freeze({ 7: resident }), actors: new Map([['ada', 7]]),
  pending: false, issues: [], reservations: {}, startedTransfers: [] })
const empty: InventionState = Object.freeze({ moments: Object.freeze([]), pending: false, issues: Object.freeze([]) })

test('strictly reads invented kinds, revisions, and coined traits', () => {
  assert.deepEqual(inventionFor(event('kind_invented', ' ada ', { name: ' Lantern moss ', kind_id: 4 })),
    { changeId: '84913', actor: 'ada', name: 'Lantern moss', subject: 'kind', subjectId: 4 })
  assert.equal(inventionFor(event('kind_revised', 'ada', { name: 'Lantern moss II', kind_id: 4 }))?.subject, 'kind')
  assert.equal(inventionFor(event('trait_coined', 'ada', { name: 'patient', trait_id: 9 }))?.subject, 'trait')
  for (const bad of [
    event('place_invented', 'ada', { name: 'room', place_id: 3 }),
    event('kind_invented', null, { name: 'x', kind_id: 1 }),
    event('kind_invented', 'ada', { name: ' ', kind_id: 1 }),
    event('kind_invented', 'ada', { name: 'x', kind_id: 0 }),
    event('trait_coined', 'ada', { name: 'x', trait_id: 1.5 }),
  ]) assert.equal(inventionFor(bad), null)
})

test('an invention stays visible for 4.4 seconds', () => {
  assert.equal(inventionDuration(), 4_400)
})

test('shows an invention without changing its resident and expires cleanly', () => {
  const before = residents.residents[7]
  const invention = inventionFor(event('kind_invented', 'ada', { name: 'Lantern moss', kind_id: 4 }))!
  const shown = stepInventions(empty, [{ invention, residentId: 7, expiresAt: 2300 }], residents, new Set(), 100)
  assert.equal(shown.pending, true)
  assert.deepEqual(shown.moments[0], { changeId: '84913', residentId: 7, name: 'Lantern moss', subject: 'kind', expiresAt: 2300 })
  assert.strictEqual(residents.residents[7], before)
  assert.equal(stepInventions(shown, [], residents, new Set(), 2300).pending, false)
})

test('quiet, missing, hidden, and unplaced inventors are not drawn and get one plain status', () => {
  const coined = inventionFor(event('trait_coined', 'ada', { name: 'patient', trait_id: 9 }))!
  const hidden = stepInventions(empty, [{ invention: coined, residentId: 7, expiresAt: 2200 }], residents, new Set([3]), 0)
  assert.deepEqual(hidden.moments, [])
  assert.match(hidden.issues[0] ?? '', /could not be shown/)
  const revised = inventionFor(event('kind_revised', 'nobody', { name: 'x', kind_id: 1 }))!
  const missing = stepInventions(empty, [{ invention: revised, residentId: 99, expiresAt: 2200 }], residents, new Set(), 0)
  assert.deepEqual(missing.moments, [])
})

test('pixel bulb is a small bounded rectangular glyph', () => {
  const cells = bulbCells()
  assert.ok(cells.length >= 8)
  assert.ok(cells.every(cell => Number.isInteger(cell.x) && Number.isInteger(cell.y) && cell.width > 0 && cell.height > 0))
  assert.ok(Math.max(...cells.map(cell => cell.x + cell.width)) <= 9)
  assert.ok(Math.max(...cells.map(cell => cell.y + cell.height)) <= 11)
  assert.ok(Object.isFrozen(cells))
})
