import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchChangeCursor, fetchCurrentPlaces } from '../src/city/current.ts'

const sourcePlace = { type: 'place', id: 3, name: 'the square', parent_id: 2, quiet: false }
const place = { id: 3, name: 'the square', parent_id: 2, owner: null, owner_id: null, quiet: false, has_drawing: false }

test('current places read the complete public directory anonymously', async t => {
  const original = globalThis.fetch
  const calls: Array<{ url: string, options?: RequestInit }> = []
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), options })
    return Response.json({ view: 'directory', places: [sourcePlace] })
  }
  t.after(() => { globalThis.fetch = original })

  assert.deepEqual(await fetchCurrentPlaces(''), [place])
  assert.equal(calls[0]?.url, 'https://1f3d9.com/api/window?view=directory')
  assert.equal(calls[0]?.options?.credentials, 'omit')
  assert.deepEqual(calls[0]?.options?.headers, { accept: 'application/json' })
  assert.ok(calls[0]?.options?.signal instanceof AbortSignal)
})

test('current place fixtures use the named map file and validate every metadata row', async t => {
  const original = globalThis.fetch
  const bodies = [
    { view: 'directory', places: [sourcePlace] },
    { view: 'directory', places: [{ ...sourcePlace, parent_id: '2' }] },
  ]
  const urls: string[] = []
  globalThis.fetch = async input => { urls.push(String(input)); return Response.json(bodies.shift()) }
  t.after(() => { globalThis.fetch = original })

  await fetchCurrentPlaces('?map=/fixtures/map-current-page1.json')
  await assert.rejects(fetchCurrentPlaces('?map=/fixtures/map-current-page1.json'), /invalid place/)
  assert.deepEqual(urls, ['/fixtures/map-current-page1.json', '/fixtures/map-current-page1.json'])
})

test('change cursor accepts a head-only response and never presents old rows', async t => {
  const original = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async input => {
    calls.push(String(input))
    return Response.json({ change_marker: '100297', changes: [{ change_id: '1', line: 'old words' }] })
  }
  t.after(() => { globalThis.fetch = original })

  assert.equal(await fetchChangeCursor(''), '100297')
  assert.equal(await fetchChangeCursor('?cursor=/fixtures/change-cursor.json'), '100297')
  assert.deepEqual(calls, ['https://1f3d9.com/api/changes', '/fixtures/change-cursor.json'])
})

test('change cursor rejects missing, unsafe, and malformed markers', async t => {
  const original = globalThis.fetch
  const bodies = [{}, { change_marker: '01' }, { change_marker: '9007199254740992' }]
  globalThis.fetch = async () => Response.json(bodies.shift())
  t.after(() => { globalThis.fetch = original })
  await assert.rejects(fetchChangeCursor(''), /cursor/)
  await assert.rejects(fetchChangeCursor(''), /cursor/)
  await assert.rejects(fetchChangeCursor(''), /cursor/)
})
