import assert from 'node:assert/strict'
import test from 'node:test'
import type { Drawing } from '../src/city/types.ts'
import { PixelPortrait, fallbackPortrait, type PortraitReaders } from '../src/scenes/PixelPortrait.ts'

const drawing: Drawing = { type: 'resident', id: 1, state: 'complete', drawing: {
  palette: ['#112233'], indices: [0, ...Array<null>(63).fill(null)],
} }

test('loads actual linked art once and uses crisp typed fallbacks when art is absent', async () => {
  let residentReads = 0; let thingReads = 0
  const readers: PortraitReaders = {
    residentDrawing: async () => { residentReads += 1; return drawing }, placeDrawing: async () => null,
    thing: async id => { thingReads += 1; return { id, name: 'current name', has_drawing: false } },
    thingDrawing: async () => { throw new Error('must not read art without its flag') },
  }
  const portraits = new PixelPortrait(readers)
  const entity = { type: 'resident' as const, id: 1, name: 'historic name', hasDrawing: true }
  const [first, second] = await Promise.all([portraits.load(entity), portraits.load(entity)])
  assert.deepEqual(first, [{ x: 0, y: 0, color: 0x112233 }]); assert.equal(second, first)
  assert.equal(residentReads, 1)
  assert.deepEqual(await portraits.load({ type: 'thing', id: 4, name: 'old thing', hasDrawing: null }), fallbackPortrait('thing'))
  assert.equal(thingReads, 1)
})

test('bounds drawing reads to four active requests', async () => {
  let active = 0; let highest = 0; const releases: (() => void)[] = []
  const wait = (): Promise<Drawing | null> => new Promise(resolve => {
    active += 1; highest = Math.max(highest, active)
    releases.push(() => { active -= 1; resolve(null) })
  })
  const readers: PortraitReaders = {
    residentDrawing: wait, placeDrawing: wait, thing: async id => ({ id, name: String(id), has_drawing: true }),
    thingDrawing: wait,
  }
  const portraits = new PixelPortrait(readers, 4)
  const pending = Array.from({ length: 8 }, (_, index) => portraits.load({ type: 'resident', id: index + 1, name: String(index), hasDrawing: true }))
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(active, 4)
  while (releases.length) { releases.shift()!(); await new Promise(resolve => setTimeout(resolve, 0)) }
  await Promise.all(pending); assert.equal(highest, 4)
})
