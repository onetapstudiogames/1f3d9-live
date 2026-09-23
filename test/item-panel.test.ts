import assert from 'node:assert/strict'
import test from 'node:test'

import { itemPanelPlacement, residentPanelFacts, thingPanelFacts } from '../src/item-panel.ts'

test('resident panel facts include the known room, current place, sleep state, and description', () => {
  assert.deepEqual(residentPanelFacts({
    placeId: 3, placeName: 'The Commons', asleep: false,
    description: 'A small yellow figure.',
  }), [
    { label: 'Where', value: 'The Commons · place #3' },
    { label: 'State', value: 'Awake' },
    { label: 'Description', value: 'A small yellow figure.' },
  ])
})

test('resident panel facts omit unknown location and empty description but keep the recorded sleep state', () => {
  assert.deepEqual(residentPanelFacts({ placeId: null, placeName: null, asleep: true, description: '  ' }), [
    { label: 'State', value: 'Asleep' },
  ])
})

test('thing panel facts include only known kind, owner, and description', () => {
  assert.deepEqual(thingPanelFacts({ kind: 'telemetry-beacon', owner: 'sputnik', description: 'A signal marker.' }), [
    { label: 'Kind', value: 'telemetry-beacon' },
    { label: 'Owner', value: 'sputnik' },
    { label: 'Description', value: 'A signal marker.' },
  ])
  assert.deepEqual(thingPanelFacts({ kind: null, owner: undefined, description: undefined }), [])
})

test('desktop item panel opens beside the sprite and flips to the left near the right edge', () => {
  const viewport = { left: 0, top: 0, right: 800, bottom: 600 }
  const panel = { width: 220, height: 180 }
  assert.deepEqual(itemPanelPlacement({ left: 40, top: 100, right: 64, bottom: 148 }, panel, viewport), {
    left: 74, top: 34, side: 'right',
  })
  assert.deepEqual(itemPanelPlacement({ left: 670, top: 550, right: 694, bottom: 598 }, panel, viewport), {
    left: 440, top: 412, side: 'left',
  })
})

test('phone item panel becomes a bottom sheet above the available content edge', () => {
  assert.deepEqual(itemPanelPlacement({ left: 0, top: 0, right: 50, bottom: 50 },
    { width: 340, height: 240 }, { left: 10, top: 20, right: 385, bottom: 700 }), {
      left: 8, top: 432, side: 'sheet',
    })
})

test('item panel placement rejects invalid or oversized measurements', () => {
  const viewport = { left: 0, top: 0, right: 100, bottom: 100 }
  assert.equal(itemPanelPlacement({ left: Number.NaN, top: 0, right: 1, bottom: 1 },
    { width: 30, height: 30 }, viewport), null)
  assert.equal(itemPanelPlacement({ left: 1, top: 1, right: 2, bottom: 2 },
    { width: 100, height: 30 }, viewport), null)
})
