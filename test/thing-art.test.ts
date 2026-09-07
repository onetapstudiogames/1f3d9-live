import { test } from 'node:test'
import assert from 'node:assert/strict'
import { thingDrawingCells, thingParticles } from '../src/thing-art.ts'

test('the one default thing icon is a small pixel parcel inside an 8 by 8 grid', () => {
  const cells = thingDrawingCells(null)
  assert.equal(cells.length, 36)
  assert.deepEqual(cells[0], { x: 1, y: 1, color: 0x805534 })
  assert.ok(cells.every(cell => cell.x >= 1 && cell.x <= 6 && cell.y >= 1 && cell.y <= 6))
  assert.deepEqual(thingDrawingCells(null), cells)
})

test('a thing keeps its own drawing pixels and palette', () => {
  const art = { type: 'thing' as const, id: 1, state: 'complete', drawing: { palette: ['#abcdef'], indices: [0, ...Array<null>(63).fill(null)] } }
  assert.deepEqual(thingDrawingCells(art), [{ x: 0, y: 0, color: 0xabcdef }])
})

test('puff and crumbs spread in whole pixels and fade, with nothing outside their time', () => {
  for (const kind of ['puff', 'crumbs'] as const) {
    assert.deepEqual(thingParticles(kind, -1), [])
    assert.deepEqual(thingParticles(kind, 1), [])
    assert.deepEqual(thingParticles(kind, Number.NaN), [])
    const start = thingParticles(kind, 0)
    const later = thingParticles(kind, 0.5)
    assert.equal(start.length, 5)
    assert.ok(later.every(cell => Number.isInteger(cell.x) && Number.isInteger(cell.y) && cell.alpha === 0.5))
    assert.ok(Math.abs(later[0]!.x) > Math.abs(start[0]!.x))
    assert.deepEqual(thingParticles(kind, 0.5), later)
  }
})
