import assert from 'node:assert/strict'
import test from 'node:test'
import { readInitialNoteWords } from '../src/scenes/SceneDetails.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import type { ReplayEvent } from '../src/city/types.ts'

const layout = nestedLayout([{ id: 1, parent_id: null, name: 'room', quiet: false }])
const note = (id: number, cut: boolean): ReplayEvent => ({ actor: 'Ada', kind: 'note',
  at: '2026-09-08T00:00:00Z', change_id: String(id), event_id: id,
  detail: { note_id: id, place_id: 1 }, line: 'recorded first line', line_cut: cut })

test('the initial room history resolves cut replay notes to their full recorded bodies', async () => {
  const events = [note(1, false), note(2, true)]
  const requested: number[] = []
  const result = await readInitialNoteWords(events, layout, async id => {
    requested.push(id)
    return { author: 'Ada', placeId: 1, text: 'recorded first line\nall the remaining words', cut: false }
  }, () => assert.fail('valid full note'))
  assert.deepEqual(requested, [2])
  assert.equal(result[0], events[0])
  assert.equal(result[1]!.line, 'recorded first line\nall the remaining words')
  assert.equal(result[1]!.line_cut, false)
  assert.equal(events[1]!.line_cut, true)
})
