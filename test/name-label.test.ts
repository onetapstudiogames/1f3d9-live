import assert from 'node:assert/strict'
import test from 'node:test'
import { labelContent, marqueeOffset, NAME_LABEL } from '../src/name-label.ts'

test('short names stay still and retain a thing kind only when both fit', () => {
  assert.deepEqual(labelContent('Small lantern', 'tool', 72, 21),
    { showKind: true, scroll: false, width: 110, textWidth: 98 })
  assert.deepEqual(labelContent('Small lantern', 'tool', 108, 21),
    { showKind: false, scroll: false, width: 120, textWidth: 108 })
  assert.equal(marqueeOffset(108, 0), 0)
  assert.equal(marqueeOffset(108, 20_000), 0)
})

test('long names pause at the start then scroll slowly through their full width', () => {
  const width = NAME_LABEL.textWidth + 48
  assert.equal(labelContent('A complete long recorded name', 'tool', width, 21).scroll, true)
  assert.deepEqual(labelContent('A complete long recorded name', 'tool', width, 21),
    { showKind: false, scroll: true, width: 124, textWidth: 112 })
  assert.equal(marqueeOffset(width, NAME_LABEL.pauseMs - 1), 0)
  assert.equal(marqueeOffset(width, NAME_LABEL.pauseMs + 1_000), -NAME_LABEL.speed)
  const cycle = NAME_LABEL.pauseMs + (width + NAME_LABEL.gap) / NAME_LABEL.speed * 1_000
  assert.equal(marqueeOffset(width, cycle), 0)
})

test('label dimensions are a fixed small card in CSS pixels', () => {
  assert.deepEqual(NAME_LABEL, {
    width: 124, height: 23, textWidth: 112, fontSize: 13,
    pauseMs: 1_200, speed: 18, gap: 28, padding: 12,
  })
})
