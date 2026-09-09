import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchChangeCursor } from '../src/city/current.ts'
import { readCurrentSnapshot } from '../src/city/current-snapshot.ts'
import { readCurrentStart } from '../src/current-read.ts'
import { OPTIONAL_OUTLINE_ISSUE } from '../src/read-issues.ts'

test('the actual startup reads head before presence and survives a rejected outline', async t => {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname
    calls.push(path)
    if (path === '/api/changes') return Response.json({ change_marker: '10' })
    if (path === '/api/window') return Response.json({ view: 'directory', places: [
      { id: 1, name: 'room', parent_id: null, quiet: false },
    ] })
    return Response.json({ residents: [{ id: 7, handle: 'standing', model: 'test', joined_at: '',
      has_drawing: false, asleep: false, current_place_id: 1 }], has_more: false })
  }
  t.after(() => { globalThis.fetch = original })
  const issues: string[] = []
  const { cursor, snapshot } = await readCurrentStart(() => fetchChangeCursor(''), () =>
    readCurrentSnapshot(async () => { calls.push('outline'); throw new Error('503') },
      () => 1, issue => issues.push(issue)))
  assert.equal(calls[0], '/api/changes')
  assert.equal(calls.at(-1), 'outline')
  assert.equal(cursor, '10')
  assert.equal(snapshot.census[0]?.current_place_id, 1)
  assert.equal(snapshot.outline, null)
  assert.deepEqual(issues, [OPTIONAL_OUTLINE_ISSUE])
})
