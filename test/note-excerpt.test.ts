import assert from 'node:assert/strict'
import test from 'node:test'

import { noteExcerpt } from '../src/note-excerpt.ts'

test('uses only the first line and marks omitted lines', () => {
  assert.equal(noteExcerpt('first line\nsecond line', false), 'first line…')
  assert.equal(noteExcerpt('first line\r\nsecond line', false), 'first line…')
})

test('caps long first lines by Unicode characters without splitting a surrogate pair', () => {
  const longLine = `${'a'.repeat(199)}😀tail`
  const excerpt = noteExcerpt(longLine, false)
  assert.equal([...excerpt.slice(0, -1)].length, 200)
  assert.equal(excerpt.endsWith('😀…'), true)
})

test('honors an upstream line cut while leaving complete short lines unchanged', () => {
  assert.equal(noteExcerpt('partial', true), 'partial…')
  assert.equal(noteExcerpt('complete', false), 'complete')
  assert.equal(noteExcerpt('', true), '…')
})
