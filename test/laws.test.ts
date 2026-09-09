import assert from 'node:assert/strict'
import test from 'node:test'
import { blockedAttemptFor, blockDuration, currentLawStatus, invalidateCurrentLaws, lockCells, parseCurrentLaws, rememberCurrentLaws } from '../src/laws.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import type { ReplayFile, Resident } from '../src/city/types.ts'
import type { NestedLayout } from '../src/ground/nested.ts'
import { createResidents, stepResidents } from '../src/replay/simulation.ts'

test('current laws accept only complete public law rows and preserve exact names', () => {
  const value = [{ traitId: 205, name: 'scoped consent', recipe: { any: true }, sourcePlaceId: 2, position: 1 }]
  assert.deepEqual(parseCurrentLaws(value), [{ traitId: 205, name: 'scoped consent', sourcePlaceId: 2, position: 1 }])
  assert.deepEqual(parseCurrentLaws([]), [])
  for (const bad of [undefined, null, {}, [{ ...value[0], traitId: 0 }], [{ ...value[0], name: '' }], [{ ...value[0], sourcePlaceId: -1 }]]) {
    assert.equal(parseCurrentLaws(bad), null)
  }
})

test('current law status names only the current live room after its outline read', () => {
  let current: ReadonlyMap<number, readonly string[] | null> = new Map()
  assert.equal(currentLawStatus(current, 97, 'lab', true), '')
  current = rememberCurrentLaws(current, 97, ['hospitable', 'marks-its-room'])
  assert.equal(currentLawStatus(current, 97, 'lab', true), 'Laws last read for lab: hospitable, marks-its-room.')
  assert.equal(currentLawStatus(current, 97, 'lab', false), '')
  assert.equal(currentLawStatus(rememberCurrentLaws(current, 2, []), 2, 'empty', true), 'Laws last read for empty: none.')
  assert.equal(currentLawStatus(rememberCurrentLaws(current, 3, null), 3, 'unclear', true), 'Laws last read for unclear: unknown.')
  assert.ok(currentLawStatus(rememberCurrentLaws(current, 4, ['wide'.repeat(80)]), 4, 'busy', true).endsWith('….'))
})

test('a live law change invalidates every inherited current-law answer', () => {
  const known = new Map<number, readonly string[]>([[97, ['regression bench']], [767, []]])
  const invalidated = invalidateCurrentLaws(known)
  assert.deepEqual([...invalidated], [[97, null], [767, null]])
  assert.deepEqual([...known], [[97, ['regression bench']], [767, []]])
})

test('only the verified blocked move shape makes a recorded padlock moment', () => {
  const event: ReplayEvent = { actor: 'scree', at: '2026-09-02T19:32:12.325Z', change_id: '84649', event_id: 84651,
    kind: 'action', detail: { action: 'move', status: 'blocked', action_id: 71583, source_thing_id: 2477, trait_id: 205 } }
  assert.deepEqual(blockedAttemptFor(event), { changeId: '84649', actor: 'scree', action: 'move' })
  assert.deepEqual(blockedAttemptFor({ ...event, detail: { action: 'talk', status: 'blocked', action_id: 2 } }),
    { changeId: '84649', actor: 'scree', action: 'talk' })
  assert.equal(blockedAttemptFor({ ...event, detail: { ...event.detail, status: 'applied' } }), null)
  assert.equal(blockedAttemptFor({ ...event, detail: { action: 'go_home', status: 'blocked', action_id: 2 } }), null)
  assert.equal(blockedAttemptFor({ ...event, actor: null }), null)
})

test('a blocked-action padlock stays visible for 4.4 seconds', () => {
  assert.equal(blockDuration(), 4_400)
})

test('the lock is a small immutable pixel glyph', () => {
  const cells = lockCells()
  assert.ok(cells.length > 4)
  assert.ok(cells.every(cell => [cell.x, cell.y, cell.width, cell.height].every(Number.isInteger)))
  assert.ok(cells.every(cell => cell.width > 0 && cell.height > 0))
  assert.ok(Object.isFrozen(cells))
})

test('a blocked attempt holds its queue turn without moving, then releases the next words', () => {
  const layout = { rootId: 1, width: 240, height: 180, rooms: { 1: { id: 1, parentId: null, name: 'room', quiet: false,
    depth: 0, x: 0, y: 0, width: 240, height: 180, door: { x: 0, y: 90 },
    standing: { x: 20, y: 20, width: 200, height: 130 }, children: [] } } } as unknown as NestedLayout
  const replay: ReplayFile = { span: '1h', window_start: '2026-09-02T19:00:00Z', window_end: '2026-09-02T20:00:00Z',
    checkpoint: '2', complete: true, row_ceiling: 2, map: { places: [] }, counts: {}, timeline: [],
    start: { 'resident:1': { origin_event_id: 1, place_id: 1 } } }
  const census: Resident[] = [{ id: 1, handle: 'scree', current_place_id: 1, model: '', joined_at: '', has_drawing: false, asleep: false }]
  const blocked: ReplayEvent = { actor: 'scree', at: replay.window_start, change_id: '1', event_id: 1, kind: 'action',
    detail: { action: 'move', status: 'blocked', action_id: 7 } }
  const note: ReplayEvent = { actor: 'scree', at: replay.window_start, change_id: '2', event_id: 2, kind: 'note',
    detail: { place_id: 1 }, line: 'afterward' }
  const initial = createResidents(replay, census, layout); const before = [initial.residents[1]!.x, initial.residents[1]!.y]
  let state = stepResidents(initial, [blocked, note], 0, 100, layout)
  assert.deepEqual([state.residents[1]!.x, state.residents[1]!.y], before)
  assert.equal(state.residents[1]!.blockedAttempt?.attempt.action, 'move')
  assert.equal(state.residents[1]!.queue.length, 1)
  state = stepResidents(state, [], 0, state.residents[1]!.blockedAttempt!.expiresAt, layout)
  assert.equal(state.residents[1]!.blockedAttempt, null)
  assert.equal(state.residents[1]!.bubble?.text, 'afterward')
})
