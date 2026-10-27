import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReplayPlace } from '../src/city/types.ts'
import { compileMutes, hiddenPlaces } from '../src/browser-mutes.ts'
import { roomDrawingHidden } from '../src/mute-view.ts'

const place = (id: number, parent_id: number | null, quiet = false): ReplayPlace => Object.freeze({
  id, parent_id, quiet, name: `Room ${id}`, owner: null, owner_id: null, has_drawing: false,
})
const visible = () => true

test('Room facts include the parent and every direct child in ID order, without grandchildren or duplicates', async () => {
  const { roomFactsLinks } = await import('../src/room-facts-links.ts')
  const places = Object.freeze([place(1, null), place(2, 1), place(8, 2), place(4, 2), place(5, 4), place(4, 2)])
  assert.deepEqual(roomFactsLinks(places, 2, visible), {
    parent: { id: 1, name: 'Room 1' }, children: [{ id: 4, name: 'Room 4' }, { id: 8, name: 'Room 8' }],
  })
})

test('a known root and leaf differ from an unavailable directory or selected room', async () => {
  const { roomFactsLinks } = await import('../src/room-facts-links.ts')
  assert.deepEqual(roomFactsLinks([place(1, null)], 1, visible), { parent: null, children: [] })
  assert.deepEqual(roomFactsLinks([place(1, null), place(2, 1)], 2, visible), {
    parent: { id: 1, name: 'Room 1' }, children: [],
  })
  for (const places of [null, []]) assert.equal(roomFactsLinks(places, 1, visible), null)
  assert.equal(roomFactsLinks([place(1, null)], null, visible), null)
})

test('missing parents, self links, cycles and conflicting duplicate records provide no navigation', async () => {
  const { roomFactsLinks } = await import('../src/room-facts-links.ts')
  for (const places of [[place(1, 99)], [place(1, 1)], [place(1, 2), place(2, 1)],
    [place(1, null), place(1, 2), place(2, null)]]) {
    assert.equal(roomFactsLinks(places, 1, visible), null)
  }
})

test('malformed IDs cannot become links or establish a parent chain', async () => {
  const { roomFactsLinks } = await import('../src/room-facts-links.ts')
  const places = [place(1, null), ...[0, -1, 1.5, NaN, Infinity].map(id => place(id, 1))]
  assert.deepEqual(roomFactsLinks(places, 1, visible), { parent: null, children: [] })
  assert.equal(roomFactsLinks([place(1, 0), place(0, null)], 1, visible), null)
})

test('quiet rooms, quiet ancestry, removed names and the supplied visibility rule withhold links', async () => {
  const { roomFactsLinks } = await import('../src/room-facts-links.ts')
  const places = [place(1, null), place(2, 1), place(3, 2, true), place(4, 3),
    { ...place(5, 2), name: '[removed by maintainer]' }, place(6, 2)]
  assert.deepEqual(roomFactsLinks(places, 2, id => id !== 1 && id !== 6), { parent: 'unavailable', children: [] })
  assert.equal(roomFactsLinks(places, 2, id => id !== 2), null)
  for (const id of [3, 4, 5]) assert.equal(roomFactsLinks(places, id, visible), null)
})

test('the existing mute rule keeps both founder-owned targets and drops other muted names', async () => {
  const { roomFactsLinks } = await import('../src/room-facts-links.ts')
  const places = [place(10, null), ...[1, 2, 3].map(id => ({ ...place(10 + id, 10), owner_id: id }))]
  const rules = compileMutes([11, 12, 13].map(id => ({ type: 'place' as const, id, choice: 'mute' as const })))
  const hidden = hiddenPlaces(rules, places)
  const result = roomFactsLinks(places, 10, id => !roomDrawingHidden(rules, hidden, places.find(row => row.id === id)))
  assert.deepEqual(result, { parent: null, children: [{ id: 11, name: 'Room 11' }, { id: 12, name: 'Room 12' }] })
  assert.equal(JSON.stringify(result).includes('Room 13'), false)
})

test('a changed directory or visibility rule removes old names without changing the selected room', async () => {
  const { roomFactsLinks } = await import('../src/room-facts-links.ts')
  const places = [place(1, null), place(2, 1)]
  assert.deepEqual(roomFactsLinks(places, 1, visible)?.children, [{ id: 2, name: 'Room 2' }])
  assert.deepEqual(roomFactsLinks(places, 1, id => id !== 2)?.children, [])
  assert.deepEqual(roomFactsLinks([place(1, null)], 1, visible)?.children, [])
})
