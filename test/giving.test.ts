import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ReplayEvent } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import {
  HEART_CELLS,
  HEART_PIXELS,
  carriedMove,
  floatFrame,
  saleFor,
  transferDuration,
  transferFor,
  transferPartners,
} from '../src/giving.ts'

const row = (kind: string, detail: Record<string, unknown>, actor: string | null = 'mara'): ReplayEvent => ({
  kind, detail, actor, at: '2026-09-07T00:00:00.000Z', change_id: '1', event_id: 1,
})

test('reads only verified typed thing transfers with complete references', () => {
  assert.deepEqual(transferFor(row('transfer', { mode: 'gift', asset_type: 'thing', asset_id: 2122, transfer_id: 86, resident_id: 274, place_id: 456 })),
    { thingId: 2122, actor: 'mara', partnerId: 274, placeId: 456 })
  assert.deepEqual(transferFor(row('transfer', { mode: 'effect', type: 'thing', id: 2915, resident_id: 262, place_id: 455 }, ' lucy ')),
    { thingId: 2915, actor: 'lucy', partnerId: 262, placeId: 455 })
  assert.deepEqual(transferFor(row('transfer', { mode: 'gift', asset_type: 'thing', asset_id: 5, resident_id: 6, place_id: 7 })),
    { thingId: 5, actor: 'mara', partnerId: 6, placeId: 7 })
  for (const detail of [
    { mode: 'gift', asset_type: 'place', asset_id: 2, resident_id: 3, place_id: 4 },
    { mode: 'gift', asset_type: 'thing', asset_id: 2, transfer_id: 1, resident_id: 0, place_id: 4 },
    { mode: 'effect', type: 'thing', id: Number.MAX_SAFE_INTEGER + 1, resident_id: 3, place_id: 4 },
  ]) assert.equal(transferFor(row('transfer', detail)), null)
  assert.equal(transferFor(row('action', { action: 'give', status: 'applied', source_thing_id: 2, resident_id: 3, place_id: 4 })), null)
  assert.equal(transferFor(row('transfer', { mode: 'gift', asset_type: 'thing', asset_id: 2, resident_id: 3, place_id: 4 }, '  ')), null)
})

test('live transfer fixture keeps old incomplete rows unlinked and reads verified complete rows', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/changes-transfers-live.json', import.meta.url), 'utf8')) as { changes: Array<Record<string, unknown>> }
  const parsed = fixture.changes.map(change => transferFor({ ...change, at: change.created_at, event_id: Number(change.change_id) } as ReplayEvent)).filter(Boolean)
  assert.ok(parsed.some(value => value?.thingId === 2122 && value.partnerId === 274))
  assert.ok(parsed.some(value => value?.thingId === 2915 && value.partnerId === 262))
  assert.equal(parsed.some(value => value?.thingId === 23), false)
})

test('does not invent sale labels from unrelated fields', () => {
  for (const detail of [
    { price: 2, name: 'sale' }, { asset_id: 7, price: 1 }, { mode: 'sale', asset_type: 'thing', asset_id: 7 },
  ]) assert.equal(saleFor(row('transfer', detail)), null)
})

test('pairs a verified carry notice even when the notice precedes its action', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/changes-carry-live.json', import.meta.url), 'utf8')) as { changes: Array<Record<string, unknown>> }
  const events = fixture.changes.map(change => ({ ...change, at: change.created_at, event_id: Number(change.change_id) } as ReplayEvent))
  assert.deepEqual(carriedMove(events[2]!, events[1]!), { thingId: 2727, actor: 'lucy', carrierId: 262, actionId: 85816, fromId: 760, toId: 759 })
  assert.equal(carriedMove(events[0]!, events[1]!), null)
  assert.equal(carriedMove(events[2]!, row('thing_moved', { ...events[1]!.detail, place_id: 758 })), null)
  assert.equal(carriedMove(row('action', { ...events[2]!.detail, status: 'noop' }, 'lucy'), events[1]!), null)
  assert.equal(carriedMove({ ...events[2]!, at: 'bad' }, { ...events[1]!, at: 'bad' }), null)
  assert.deepEqual(carriedMove(events[2]!, { ...events[1]!, at: '2026-09-07T08:30:43.000Z' }),
    { thingId: 2727, actor: 'lucy', carrierId: 262, actionId: 85816, fromId: 760, toId: 759 })
})

test('rejects incomplete, unsafe, failed, and error-bearing carry pairs', () => {
  const action = row('action', { mode: 'carry', action: 'move', status: 'applied', thing_id: 12, action_id: 20, from_place_id: 2, to_place_id: 3 }, 'carrier')
  const notice = row('thing_moved', { mode: 'carry', thing_id: 12, action_id: 20, resident_id: 7, from_place_id: 2, place_id: 3 }, 'carrier')
  for (const status of ['failed', 'noop']) assert.equal(carriedMove({ ...action, detail: { ...action.detail, status } }, notice), null)
  for (const error of ['', 'denied']) assert.equal(carriedMove({ ...action, detail: { ...action.detail, error } }, notice), null)
  assert.equal(carriedMove(action, { ...notice, detail: { ...notice.detail, error: '' } }), null)
  assert.equal(carriedMove(action, { ...notice, actor: 'other' }), null)
  for (const key of ['thing_id', 'action_id', 'from_place_id', 'place_id'] as const) {
    assert.equal(carriedMove(action, { ...notice, detail: { ...notice.detail, [key]: key === 'thing_id' ? 99 : null } }), null)
  }
  for (const key of ['thing_id', 'action_id', 'from_place_id', 'to_place_id'] as const) {
    assert.equal(carriedMove({ ...action, detail: { ...action.detail, [key]: key === 'action_id' ? '20' : 0 } }, notice), null)
  }
  assert.equal(carriedMove(action, { ...notice, detail: { ...notice.detail, resident_id: Number.MAX_SAFE_INTEGER + 1 } }), null)
  assert.equal(carriedMove(row('action', { ...action.detail, action: 'give' }, 'carrier'), notice), null)
  assert.equal(carriedMove(action, row('transfer', notice.detail, 'carrier')), null)
})

test('times and rounds the floating gift arc, then expires exactly', () => {
  assert.equal(transferDuration(), 1200)
  assert.equal(transferDuration(1200), 400)
  assert.equal(transferDuration(0), 1200)
  assert.deepEqual(floatFrame({ x: 0, y: 20 }, { x: 101, y: 20 }, 1000, 1000), { x: 0, y: 20, heartX: 0, heartY: 8, alpha: 1 })
  const middle = floatFrame({ x: 0, y: 20 }, { x: 101, y: 20 }, 1000, 1600)!
  assert.deepEqual({ x: middle.x, y: middle.y }, { x: 51, y: -12 })
  assert.ok(middle.alpha >= 0 && middle.alpha <= 1)
  assert.equal(floatFrame({ x: 0, y: 0 }, { x: 1, y: 1 }, 1000, 2200), null)
  assert.equal(floatFrame({ x: 0, y: 0 }, { x: 1, y: 1 }, 1000, 1400, 1200), null)
  const fading = floatFrame({ x: 0, y: 0 }, { x: 100, y: 0 }, 1000, 2100)!
  assert.ok(fading.alpha > 0 && fading.alpha < 1)
  assert.equal(floatFrame({ x: 0, y: 0 }, { x: 1, y: 1 }, 1000, 999), null)
  assert.equal(floatFrame({ x: 0, y: 0 }, { x: 1, y: 1 }, 1000, Infinity), null)
  assert.equal(floatFrame({ x: 0, y: 0 }, { x: Infinity, y: 1 }, 1000, 1001), null)
  assert.equal(floatFrame({ x: 0, y: 0 }, { x: 1, y: 1 }, NaN, 1001), null)
})

test('finds two stationary visible residents in a committed visible room', () => {
  const layout = nestedLayout([{ id: 1, parent_id: null }, { id: 2, parent_id: 1 }])
  const residents = {
    4: { id: 4, handle: 'mara', placeId: 2, x: 10, y: 20, visible: true, walking: false },
    9: { id: 9, handle: 'friend', placeId: 2, x: 70, y: 80, visible: true, walking: false },
  }
  const transfer = { thingId: 3, actor: 'mara', partnerId: 9, placeId: 2 }
  assert.deepEqual(transferPartners(transfer, residents, layout), { from: { x: 10, y: 20 }, to: { x: 70, y: 80 } })
  assert.equal(transferPartners(transfer, { ...residents, 9: { ...residents[9], walking: true } }, layout), null)
  assert.equal(transferPartners(transfer, { 9: residents[9]! }, layout), null)
  assert.equal(transferPartners(transfer, { ...residents, 4: { ...residents[4], visible: false } }, layout), null)
  assert.equal(transferPartners(transfer, { ...residents, 4: { ...residents[4], walking: true } }, layout), null)
  assert.equal(transferPartners(transfer, { ...residents, 4: { ...residents[4], placeId: 1 } }, layout), null)
  assert.equal(transferPartners(transfer, { ...residents, 9: { ...residents[9], x: NaN } }, layout), null)
  const quiet = nestedLayout([{ id: 1, parent_id: null, quiet: true }, { id: 2, parent_id: 1 }])
  assert.equal(transferPartners(transfer, residents, quiet), null)
  const quietSelf = nestedLayout([{ id: 1, parent_id: null }, { id: 2, parent_id: 1, quiet: true }])
  assert.equal(transferPartners(transfer, residents, quietSelf), null)
  assert.equal(transferPartners({ ...transfer, partnerId: 99 }, residents, layout), null)
})

test('heart is a small immutable pixel glyph', () => {
  assert.ok(HEART_CELLS.length >= 8 && HEART_CELLS.length <= 25)
  const keys = new Set(HEART_CELLS.map(([x, y]) => `${x},${y}`))
  assert.equal(keys.size, HEART_CELLS.length)
  for (const [x, y] of HEART_CELLS) {
    assert.ok(Number.isInteger(x) && Number.isInteger(y) && x >= -3 && x <= 3 && y >= 0 && y <= 4)
    assert.ok(Object.isFrozen(HEART_CELLS.find(cell => cell[0] === x && cell[1] === y)!))
    assert.equal(keys.has(`${2 - x},${y}`), true)
  }
  assert.ok(Object.isFrozen(HEART_CELLS))
  assert.equal(HEART_PIXELS.length, HEART_CELLS.length)
  assert.ok(Object.isFrozen(HEART_PIXELS) && HEART_PIXELS.every(Object.isFrozen))
})
