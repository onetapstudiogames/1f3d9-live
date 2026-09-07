import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ReplayEvent, ReplayFile, ReplayPlace } from '../src/city/types.ts'
import type { NestedLayout } from '../src/ground/nested.ts'
import {
  hiddenRooms,
  nameAtTime,
  parseFounding,
  parseNameHistory,
  parseRenaming,
  planPlaces,
  recordedRoomName,
} from '../src/places.ts'

const event = (kind: string, at: string, changeId: string, detail: Record<string, unknown>, actor: string | null = 'mara'): ReplayEvent => ({
  actor, at, change_id: changeId, event_id: Number(changeId), kind, detail,
})

const places: readonly ReplayPlace[] = [
  { id: 195, name: 'world', parent_id: null, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 2, name: 'town', parent_id: 195, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 10, name: 'new room', parent_id: 2, owner: 'mara', owner_id: 1, quiet: false, has_drawing: false },
  { id: 11, name: 'child', parent_id: 10, owner: 'mara', owner_id: 1, quiet: false, has_drawing: false },
  { id: 300, name: 'new continent', parent_id: 195, owner: 'mara', owner_id: 1, quiet: false, has_drawing: false },
]

const replay = (timeline: readonly ReplayEvent[]): ReplayFile => ({
  span: '1h', window_start: '2026-09-07T10:00:00.000Z', window_end: '2026-09-07T11:00:00.000Z',
  checkpoint: '9', complete: true, row_ceiling: 800, map: { places }, start: {}, counts: {}, timeline,
})

test('parses exact founding and renaming rows', () => {
  assert.deepEqual(parseFounding(event('place_created', '2026-09-07T10:10:00.000Z', '3', { name: 'new room', place_id: 10, parent_id: 2, frontier: true })), {
    placeId: 10, parentId: 2, name: 'new room', actor: 'mara', time: Date.parse('2026-09-07T10:10:00.000Z'), changeId: '3', frontier: true,
  })
  assert.deepEqual(parseRenaming(event('place_renamed', '2026-09-07T10:20:00.000Z', '4', { name: 'new room', place_id: 10, former_name: 'old room' })), {
    placeId: 10, name: 'new room', formerName: 'old room', time: Date.parse('2026-09-07T10:20:00.000Z'), changeId: '4',
  })
  assert.equal(parseFounding(event('place_created', 'bad', '3', { name: 'x', place_id: 10, parent_id: 2 })), null)
  assert.equal(parseFounding({ ...event('place_created', '2026-09-07T10:10:00.000Z', '3', {}), detail: null } as unknown as ReplayEvent), null)
  assert.equal(parseFounding(event('place_created', '2026-09-07T10:10:00.000Z', '3', { name: ' ', place_id: 10, parent_id: 2 }, ' ')), null)
  assert.equal(parseRenaming(event('place_edited', '2026-09-07T10:20:00.000Z', '4', { name: 'x', place_id: 10 })), null)
})

test('saved live notices adapt to replay time without changing their detail', () => {
  const saved = (name: string): { changes: Array<Record<string, unknown>> } =>
    JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as { changes: Array<Record<string, unknown>> }
  const adapt = (row: Record<string, unknown>): ReplayEvent => ({
    ...(row as unknown as ReplayEvent), at: row.created_at as string, event_id: Number(row.change_id),
  })
  assert.equal(parseFounding(adapt(saved('changes-place-created.json').changes[0]!))?.name, 'The Wrong Hat')
  const rename = parseRenaming(adapt(saved('changes-place-renamed.json').changes[0]!))
  assert.equal(rename?.formerName, 'Temporary Office of Unnecessary Inspections: Case 00')
  assert.equal(rename?.name, 'Federal Office of Unnecessary Inspections')
  const outline = JSON.parse(readFileSync(new URL('fixtures/outline-place-264.json', import.meta.url), 'utf8')) as { place: { name_history: unknown } }
  assert.equal(parseNameHistory(outline.place.name_history)?.length, 2)
})

test('validates history and leaves gaps unnamed', () => {
  const history = parseNameHistory([
    { name: 'one', started_at: '2026-09-07T09:00:00.000Z', ended_at: '2026-09-07T10:00:00.000Z' },
    { name: 'two', started_at: '2026-09-07T10:00:00.000Z', ended_at: null },
  ])!
  assert.equal(nameAtTime(history, Date.parse('2026-09-07T10:00:00.000Z')), 'two')
  assert.equal(nameAtTime(history, Date.parse('2026-09-07T08:00:00.000Z')), null)
  const gap = parseNameHistory([
    { name: 'one', started_at: '2026-09-07T09:00:00.000Z', ended_at: '2026-09-07T09:30:00.000Z' },
    { name: 'two', started_at: '2026-09-07T10:00:00.000Z', ended_at: null },
  ])!
  assert.equal(nameAtTime(gap, Date.parse('2026-09-07T09:45:00.000Z')), null)
  assert.equal(parseNameHistory([{ name: 'x', started_at: 'bad', ended_at: null }]), null)
  assert.equal(parseNameHistory([
    { name: 'one', started_at: '2026-09-07T09:00:00.000Z', ended_at: '2026-09-07T11:00:00.000Z' },
    { name: 'two', started_at: '2026-09-07T10:00:00.000Z', ended_at: null },
  ]), null)
})

test('plans recorded founding and rename without leaking the snapshot name', () => {
  const founding = event('place_created', '2026-09-07T10:10:00.000Z', '3', { name: 'old room', place_id: 10, parent_id: 2 })
  const rename = event('place_renamed', '2026-09-07T10:20:00.000Z', '4', { name: 'new room', place_id: 10 })
  const history = parseNameHistory([
    { name: 'old room', started_at: '2026-09-07T10:10:00.000Z', ended_at: '2026-09-07T10:20:00.000Z' },
    { name: 'new room', started_at: '2026-09-07T10:20:00.000Z', ended_at: null },
  ])!
  const plan = planPlaces(replay([founding, rename]), new Map([[10, history]]))
  assert.equal(recordedRoomName(plan, places[2]!, Date.parse('2026-09-07T10:09:59.000Z')), null)
  assert.equal(recordedRoomName(plan, places[2]!, Date.parse('2026-09-07T10:15:00.000Z')), 'old room')
  assert.equal(recordedRoomName(plan, places[2]!, Date.parse('2026-09-07T10:20:00.000Z')), 'new room')
  assert.deepEqual(plan.historyPlaceIds, [])
})

test('requests history for an unknown predecessor and refuses snapshot fallback', () => {
  const rename = event('place_renamed', '2026-09-07T10:20:00.000Z', '4', { name: 'new room', place_id: 10 })
  const plan = planPlaces(replay([rename]))
  assert.deepEqual(plan.historyPlaceIds, [10])
  assert.equal(recordedRoomName(plan, places[2]!, Date.parse('2026-09-07T10:10:00.000Z')), null)
  assert.equal(recordedRoomName(plan, places[2]!, Date.parse('2026-09-07T10:20:00.000Z')), 'new room')
  assert.equal(recordedRoomName(plan, places[1]!, Date.parse('2026-09-07T10:10:00.000Z')), 'town')
})

test('hides future founded rooms and descendants', () => {
  const plan = planPlaces(replay([event('place_created', '2026-09-07T10:10:00.000Z', '3', { name: 'new room', place_id: 10, parent_id: 2 })]))
  const layout = { rootId: 195, width: 1, height: 1, rooms: {
    195: { id: 195, parentId: null, children: [2] }, 2: { id: 2, parentId: 195, children: [10] },
    10: { id: 10, parentId: 2, children: [11] }, 11: { id: 11, parentId: 10, children: [] },
  } } as unknown as NestedLayout
  assert.deepEqual([...hiddenRooms(plan, layout, Date.parse('2026-09-07T10:09:00.000Z'))].sort(), [10, 11])
  assert.deepEqual([...hiddenRooms(plan, layout, Date.parse('2026-09-07T10:10:00.000Z'))], [])
})

test('rejects mismatched and contradictory founding rows conservatively', () => {
  const wrongParent = event('place_created', '2026-09-07T10:10:00.000Z', '3', { name: 'new room', place_id: 10, parent_id: 195 })
  const first = event('place_created', '2026-09-07T10:10:00.000Z', '5', { name: 'new room', place_id: 10, parent_id: 2 })
  const conflict = event('place_created', '2026-09-07T10:11:00.000Z', '6', { name: 'other', place_id: 10, parent_id: 2 })
  const plan = planPlaces(replay([wrongParent, first, first, conflict]))
  assert.equal(plan.foundings.has(10), false)
  assert.equal(plan.unresolvedFoundings.has(10), true)
  assert.ok(plan.issues.length >= 2)
})

test('an unresolved founding hides its whole room tree for the entire replay', () => {
  const malformed = event('place_created', '2026-09-07T10:10:00.000Z', '3', { name: '', place_id: 10, parent_id: 2 })
  const plan = planPlaces(replay([malformed]))
  const layout = { rootId: 195, width: 1, height: 1, rooms: {
    195: { id: 195, parentId: null, children: [2] }, 2: { id: 2, parentId: 195, children: [10] },
    10: { id: 10, parentId: 2, children: [11] }, 11: { id: 11, parentId: 10, children: [] },
  } } as unknown as NestedLayout
  assert.deepEqual([...hiddenRooms(plan, layout, Date.parse('2026-09-07T10:00:00.000Z'))].sort(), [10, 11])
  assert.deepEqual([...hiddenRooms(plan, layout, Date.parse('2026-09-07T11:00:00.000Z'))].sort(), [10, 11])
  assert.ok(plan.issues.some(issue => issue.includes('founding')))
})

test('keeps outside-window rows inert and rejects frontier away from the world root', () => {
  const outside = event('place_renamed', '2026-09-07T09:59:59.000Z', '1', { name: 'past', place_id: 2 })
  const frontier = event('place_created', '2026-09-07T10:10:00.000Z', '2', { name: 'new room', place_id: 10, parent_id: 2, frontier: true })
  const plan = planPlaces(replay([outside, frontier]))
  assert.equal(recordedRoomName(plan, places[1]!, Date.parse('2026-09-07T10:30:00.000Z')), 'town')
  assert.equal(plan.foundings.has(10), false)
  assert.ok(plan.issues.some(issue => issue.includes('frontier')))
})

test('keeps a frontier founding whose parent is the map root', () => {
  const frontier = event('place_created', '2026-09-07T10:10:00.000Z', '7', { name: 'new continent', place_id: 300, parent_id: 195, frontier: true })
  const plan = planPlaces(replay([frontier]))
  assert.equal(plan.foundings.get(300)?.frontier, true)
  assert.equal(recordedRoomName(plan, places[4]!, Date.parse('2026-09-07T10:09:00.000Z')), null)
  assert.equal(recordedRoomName(plan, places[4]!, Date.parse('2026-09-07T10:30:00.000Z')), 'new continent')
  assert.deepEqual(plan.issues, [])
})

test('same-instant renames are ordered by change id as a number, not as text', () => {
  const smaller = event('place_renamed', '2026-09-07T10:20:00.000Z', '9999', { name: 'the same name', former_name: 'old room', place_id: 10 })
  const larger = event('place_renamed', '2026-09-07T10:20:00.000Z', '10000', { name: 'the same name', former_name: 'the same name', place_id: 10 })
  const plan = planPlaces(replay([larger, smaller]))
  assert.deepEqual(plan.renamings.get(10)?.map(row => row.changeId), ['9999', '10000'])
})

test('one incomplete-notice sentence is said once, however many rows are incomplete', () => {
  const first = event('place_created', '2026-09-07T10:10:00.000Z', '3', { name: '', place_id: 10, parent_id: 2 })
  const second = event('place_created', '2026-09-07T10:12:00.000Z', '4', { name: '', place_id: 11, parent_id: 10 })
  const plan = planPlaces(replay([first, second]))
  assert.equal(plan.issues.filter(issue => issue.includes('notice is incomplete')).length, 1)
  assert.equal(plan.unresolvedFoundings.has(11), true)
})

test('history supplies only the immediate recorded predecessor and never swaps by itself', () => {
  const rename = event('place_renamed', '2026-09-07T10:20:00.000Z', '4', { name: 'new room', place_id: 10 })
  const history = parseNameHistory([
    { name: 'ancient', started_at: '2026-09-07T09:00:00.000Z', ended_at: '2026-09-07T10:00:00.000Z' },
    { name: 'old room', started_at: '2026-09-07T10:00:00.000Z', ended_at: '2026-09-07T10:20:00.000Z' },
    { name: 'new room', started_at: '2026-09-07T10:20:00.000Z', ended_at: null },
  ])!
  const plan = planPlaces(replay([rename]), new Map([[10, history]]))
  assert.equal(recordedRoomName(plan, places[2]!, Date.parse('2026-09-07T09:30:00.000Z')), null)
  assert.equal(recordedRoomName(plan, places[2]!, Date.parse('2026-09-07T10:10:00.000Z')), 'old room')
  assert.equal(recordedRoomName(plan, places[2]!, Number.NaN), null)
})

test('history without an exact predecessor reports the blank earlier sign', () => {
  const rename = event('place_renamed', '2026-09-07T10:20:00.000Z', '4', { name: 'new room', place_id: 10 })
  const history = parseNameHistory([
    { name: 'old room', started_at: '2026-09-07T10:00:00.000Z', ended_at: '2026-09-07T10:30:00.000Z' },
  ])!
  const plan = planPlaces(replay([rename]), new Map([[10, history]]))
  assert.equal(recordedRoomName(plan, places[2]!, Date.parse('2026-09-07T10:10:00.000Z')), null)
  assert.ok(plan.issues.some(issue => issue.includes('not in its recorded history')))
})

test('contradictory rename order leaves every affected name blank', () => {
  const rename = event('place_renamed', '2026-09-07T10:05:00.000Z', '2', { name: 'new room', former_name: 'old room', place_id: 10 })
  const founding = event('place_created', '2026-09-07T10:10:00.000Z', '3', { name: 'old room', place_id: 10, parent_id: 2 })
  const plan = planPlaces(replay([rename, founding]))
  assert.equal(plan.renamings.has(10), false)
  assert.equal(recordedRoomName(plan, places[2]!, Date.parse('2026-09-07T10:30:00.000Z')), 'old room')
  assert.ok(plan.issues.some(issue => issue.includes('contradictory renaming')))
})

test('rename-only change id conflict blanks the sign without hiding the room', () => {
  const first = event('place_renamed', '2026-09-07T10:20:00.000Z', '4', { name: 'one', former_name: 'old room', place_id: 10 })
  const conflict = event('place_renamed', '2026-09-07T10:20:00.000Z', '4', { name: 'two', former_name: 'old room', place_id: 10 })
  const plan = planPlaces(replay([first, conflict]))
  const layout = { rootId: 195, width: 1, height: 1, rooms: {
    10: { id: 10, parentId: 2, children: [11] }, 11: { id: 11, parentId: 10, children: [] },
  } } as unknown as NestedLayout
  assert.equal(plan.unresolvedFoundings.has(10), false)
  assert.deepEqual([...hiddenRooms(plan, layout, Date.parse('2026-09-07T10:30:00.000Z'))], [])
  assert.equal(recordedRoomName(plan, places[2]!, Date.parse('2026-09-07T10:30:00.000Z')), null)
})
