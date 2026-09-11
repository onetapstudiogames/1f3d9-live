import assert from 'node:assert/strict'
import test from 'node:test'
import { labelContent, NAME_LABEL, shortenLabelName } from '../src/name-label.ts'

test('short names stay still and retain a thing kind only when both fit', () => {
  assert.deepEqual(labelContent('Small lantern', 'tool', 72, 21),
    { showKind: true, width: 110, textWidth: 98 })
  assert.deepEqual(labelContent('Small lantern', 'tool', 108, 21),
    { showKind: false, width: 120, textWidth: 108 })
  assert.equal(shortenLabelName('Small lantern', NAME_LABEL.textWidth, text => text.length * 8), 'Small lantern')
})

test('long names end in three dots and always show a meaningful start', () => {
  const measure = (text: string): number => [...text].length * 8
  assert.equal(shortenLabelName('World-Stamped Copper Lantern', 112, measure), 'World-Stamp...')
  assert.equal(shortenLabelName('HOW TO CONTRIBUTE', 112, measure), 'HOW TO CONT...')
  assert.equal(shortenLabelName('👩🏽‍💻 builds a lantern', 80, measure), '👩🏽‍💻 bu...')
  assert.equal(shortenLabelName('', 112, measure), '')
})

test('label dimensions are a fixed small card in CSS pixels', () => {
  assert.deepEqual(NAME_LABEL, {
    width: 124, height: 23, textWidth: 112, fontSize: 13, padding: 12,
  })
})
