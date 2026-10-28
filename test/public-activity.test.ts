import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchCensus, fetchPlaceOutline } from '../src/city/api.ts'
import { residentPanelFacts } from '../src/item-panel.ts'
import { withoutResidentActivity } from '../src/public-activity.ts'

const bands = ['active now', 'today', 'this week', 'longer'] as const
const resident = { id: 3, handle: 'resident-3', model: '', joined_at: '2026-01-01T00:00:00Z',
  has_drawing: false, current_place_id: 3, asleep: false }
const place = { id: 3, name: 'the square', parent_id: null, owner: 'resident-3', owner_id: 3, quiet: false }
const facts = { placeId: 3, placeName: 'the square', asleep: false, description: null }

for (const band of bands) test(`public reads carry ${band} without another request`, async t => {
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    calls.push(String(input))
    return Response.json(String(input).includes('/residents')
      ? { residents: [{ ...resident, last_active: band }], has_more: false }
      : { place: { ...place, last_active: band }, things: [], things_page: { total_items: 0, has_more: false } })
  })
  assert.equal((await fetchCensus(''))[0]?.last_active, band)
  assert.equal((await fetchPlaceOutline(3, ''))?.lastActive, band)
  assert.deepEqual(calls, ['https://1f3d9.com/api/residents?view=presence&limit=200',
    'https://1f3d9.com/api/place/3?view=outline'])
})

test('resident facts place each band beside the independent awake or asleep state', () => {
  for (const lastActive of bands) for (const asleep of [true, false]) {
    assert.deepEqual(residentPanelFacts({ ...facts, asleep, lastActive })[1],
      { label: 'State', value: `${asleep ? 'Asleep' : 'Awake'} · ${lastActive}` })
  }
})

test('missing and unexpected bands leave no field or extra resident fact', async t => {
  let value: unknown
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => Response.json(
    String(input).includes('/residents')
      ? { residents: [{ ...resident, last_active: value }], has_more: false }
      : { place: { ...place, last_active: value }, things: [], things_page: { total_items: 0, has_more: false } }))
  for (value of [undefined, null, '', 'yesterday', 'Active now', '<b>today</b>', 0, {}, []]) {
    assert.equal(Object.hasOwn((await fetchCensus(''))[0]!, 'last_active'), false)
    assert.equal(Object.hasOwn((await fetchPlaceOutline(3, ''))!, 'lastActive'), false)
    assert.deepEqual(residentPanelFacts({ ...facts, lastActive: value }), residentPanelFacts(facts))
  }
})

test('a fresh omission replaces a previous band for both public reads', async t => {
  let activity: { last_active?: string } = { last_active: 'today' }
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => Response.json(
    String(input).includes('/residents')
      ? { residents: [{ ...resident, ...activity }], has_more: false }
      : { place: { ...place, ...activity }, things: [], things_page: { total_items: 0, has_more: false } }))
  const before = (await fetchCensus(''))[0]!
  const roomBefore = await fetchPlaceOutline(3, '')
  activity = {}
  const off = (await fetchCensus(''))[0]!
  const noHistory = (await fetchCensus(''))[0]!
  assert.deepEqual(off, noHistory)
  assert.equal(Object.hasOwn(off, 'last_active'), false)
  assert.equal(Object.hasOwn((await fetchPlaceOutline(3, ''))!, 'lastActive'), false)
  assert.equal(before.last_active, 'today')
  assert.equal(roomBefore?.lastActive, 'today')
})

test('quiet, feed and removed room outlines omit activity', async t => {
  let fields = {}
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    place: { ...place, last_active: 'today', ...fields }, things: [], things_page: { total_items: 0, has_more: false },
  }))
  for (fields of [{ quiet: true }, { feed: true }, { name: '[removed by maintainer]' }]) {
    assert.equal(Object.hasOwn((await fetchPlaceOutline(3, ''))!, 'lastActive'), false)
  }
})

test('clearing retained census bands preserves all other facts and the original rows', () => {
  const rows = [{ ...resident, last_active: 'today' as const }, { ...resident, id: 4 }] as const
  assert.deepEqual(withoutResidentActivity(rows), [resident, { ...resident, id: 4 }])
  assert.equal(rows[0]!.last_active, 'today')
  assert.deepEqual(withoutResidentActivity([]), [])
})
