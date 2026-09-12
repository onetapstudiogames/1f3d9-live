import assert from 'node:assert/strict'
import test from 'node:test'
import type { Drawing } from '../src/city/types.ts'
import { readResidentDrawings, readVisibleThingDetails, rememberOutlineThingDetails, residentDrawingCandidates,
  residentDrawingPending } from '../src/scenes/SceneDetails.ts'
import type { ThingState } from '../src/things.ts'

const thing = (id: number): ThingState => ({ id, placeId: 498, name: `thing ${id}`, x: 100, y: 100, visible: true, effect: null })
const drawing = (id: number): Drawing => ({ type: 'thing', id, state: 'complete', drawing: { palette: ['#123456'], indices: Array(64).fill(0) } })

test('visible priority residents request their own drawings first and use a neutral placeholder while waiting', async () => {
  const census = [1, 2, 3, 4, 5].map(id => ({ id, handle: `resident-${id}`, model: '', joined_at: '',
    current_place_id: 2, has_drawing: true, asleep: false }))
  const residents = Object.fromEntries(census.map(row => [row.id, { id: row.id }])) as never
  const reads: number[] = []
  await readResidentDrawings(census, residents, async id => { reads.push(id); return null }, () => {}, () => {}, new Set([5]))
  assert.deepEqual(reads, [5, 1, 2, 3, 4])
  assert.equal(residentDrawingPending(census[4], false), true)
  assert.equal(residentDrawingPending(census[4], true), false)
  assert.equal(residentDrawingPending({ ...census[4]!, has_drawing: false }, false), false)
})

test('resident drawing candidates include only visible unresolved IDs and respect the retry cadence', () => {
  const census = [1, 2, 3, 4].map(id => ({ id, handle: `resident-${id}`, model: '', joined_at: '',
    current_place_id: 2, has_drawing: true, asleep: false }))
  const visible = new Set([1, 2, 3])
  assert.deepEqual(residentDrawingCandidates(census, visible, new Set([1]), new Set([2]), new Map([[3, 31_000]]), 1_000), [])
  assert.deepEqual(residentDrawingCandidates(census, visible, new Set([1]), new Set([2]), new Map([[3, 31_000]]), 31_000)
    .map(row => row.id), [3])
})

test('resident drawing failures and pending art remain retryable while complete art is applied once', async t => {
  t.mock.method(console, 'error', () => {})
  const census = [1, 2, 3].map(id => ({ id, handle: `resident-${id}`, model: '', joined_at: '',
    current_place_id: 2, has_drawing: true, asleep: false }))
  const applied: number[] = []
  const retry = await readResidentDrawings(census, {} as never, async id => {
    if (id === 2) throw new Error('offline')
    return id === 3 ? drawing(id) : null
  }, id => { applied.push(id) }, () => {})
  assert.deepEqual(applied, [3])
  assert.deepEqual(retry, [1, 2])

  const retryAt = new Map(retry.map(id => [id, 31_000]))
  const visible = new Set([1, 2, 3])
  assert.deepEqual(residentDrawingCandidates(census, visible, new Set(applied), new Set(), retryAt, 30_999), [])
  assert.deepEqual(residentDrawingCandidates(census, visible, new Set(applied), new Set(), retryAt, 31_000)
    .map(row => row.id), [1, 2])
})

function setup(ids: readonly number[]) {
  const state = { shown: ids.map(thing) }
  const reads: number[] = []; const names: number[] = []; const applied: number[] = []; const issues: string[] = []
  const options = {
    shown: () => state.shown,
    namesRead: new Set(ids), drawingsRead: new Set<number>(), drawingHints: new Map<number, boolean | undefined>(),
    readThing: async (id: number) => { names.push(id); return null },
    readDrawing: async (id: number) => { reads.push(id); return id % 2 ? drawing(id) : null },
    applyName: () => {}, applyDrawing: (id: number) => { applied.push(id) }, issue: (text: string) => { issues.push(text) },
  }
  return { state, reads, names, applied, issues, options }
}

test('shown outline things with unknown flags read art once, caching complete and absent drawings', async () => {
  const run = setup([1, 2, 3])
  await readVisibleThingDetails(run.options)
  await readVisibleThingDetails(run.options)
  assert.deepEqual(run.reads, [1, 2, 3])
  assert.deepEqual(run.applied, [1, 3])
  assert.deepEqual(run.names, [])
  assert.deepEqual(run.issues, [])
})

test('explicit false skips art, true reads it, and a later true flag becomes eligible', async () => {
  const run = setup([1, 2])
  run.options.drawingHints.set(1, false)
  run.options.drawingHints.set(2, true)
  await readVisibleThingDetails(run.options)
  assert.deepEqual(run.reads, [2])
  run.options.drawingHints.set(1, true)
  await readVisibleThingDetails(run.options)
  assert.deepEqual(run.reads, [2, 1])
})

test('outline metadata retains a known drawing flag when a later row omits it', async () => {
  const run = setup([1])
  const names: string[] = []
  const remember = (hasDrawing: boolean | undefined) => rememberOutlineThingDetails({ id: 1, name: 'parcel', placeId: 498, hasDrawing },
    { ...run.options, applyName: (_id, name) => { names.push(name) } })
  remember(false)
  remember(undefined)
  await readVisibleThingDetails(run.options)
  assert.deepEqual(run.reads, [])
  remember(true)
  await readVisibleThingDetails(run.options)
  assert.deepEqual(run.reads, [1])
  assert.deepEqual(names, ['parcel', 'parcel', 'parcel'])
})

test('newly shown things get art, while hidden things never start a read', async () => {
  const run = setup([1])
  await readVisibleThingDetails(run.options)
  run.state.shown = [thing(2)]
  run.options.namesRead.add(2)
  await readVisibleThingDetails(run.options)
  run.state.shown = [thing(1)]
  await readVisibleThingDetails(run.options)
  assert.deepEqual(run.reads, [1, 2])
})

test('a room switch between batches stops reads for the old room and concurrency stays at four', async () => {
  const run = setup([1, 2, 3, 4, 5, 6])
  let active = 0; let maximum = 0
  run.options.readDrawing = async id => {
    run.reads.push(id); active += 1; maximum = Math.max(maximum, active)
    await Promise.resolve()
    run.state.shown = []; active -= 1
    return null
  }
  await readVisibleThingDetails(run.options)
  assert.deepEqual(run.reads, [1, 2, 3, 4])
  assert.equal(maximum, 4)
})

test('a thing hidden during its name read does not start an art read', async () => {
  const run = setup([1])
  run.options.namesRead.clear()
  await readVisibleThingDetails({ ...run.options, readThing: async id => {
    run.state.shown = []
    return { id, name: 'named', has_drawing: true }
  } })
  assert.deepEqual(run.reads, [])
  assert.equal(run.options.namesRead.has(1), true)
  assert.equal(run.options.drawingHints.get(1), true)
})

test('live thing detail supplies its name and explicit drawing flag before the art decision', async () => {
  const run = setup([1, 2])
  run.options.namesRead.clear()
  const names: string[] = []
  await readVisibleThingDetails({ ...run.options,
    readThing: async id => ({ id, name: `current ${id}`, has_drawing: id === 1 }),
    applyName: (_id, name) => { names.push(name) },
  })
  assert.deepEqual(names, ['current 1', 'current 2'])
  assert.deepEqual(run.reads, [1])
})

test('missing and failed names stay honest while visible unknown art can still load', async t => {
  t.mock.method(console, 'error', () => {})
  const run = setup([1, 2])
  run.state.shown = run.state.shown.map(row => ({ ...row, name: null }))
  run.options.namesRead.clear()
  await readVisibleThingDetails({ ...run.options, readThing: async id => {
    if (id === 2) throw new Error('offline')
    return null
  } })
  assert.deepEqual(run.reads, [1, 2])
  assert.equal(run.issues.length, 2)
  assert.match(run.issues[0]!, /missing/)
  assert.match(run.issues[1]!, /could not be read/)
})

test('missing detail does not suppress an unknown drawing and failed art is attempted once', async t => {
  t.mock.method(console, 'error', () => {})
  const run = setup([1])
  run.options.namesRead.clear()
  run.options.readDrawing = async id => { run.reads.push(id); throw new Error('offline') }
  await readVisibleThingDetails(run.options)
  await readVisibleThingDetails(run.options)
  assert.deepEqual(run.names, [1])
  assert.deepEqual(run.reads, [1])
  assert.equal(run.issues.length, 1)
})
