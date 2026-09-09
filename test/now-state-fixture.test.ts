import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseChangesPage } from '../src/city/changes.ts'
import type { ReplayEvent, ReplayFile, Resident } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { recordedRoomCapacity, settleRecordedScene } from './helpers/recorded-scene.ts'

const saved = <T>(name: string): T => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as T
const day = saved<ReplayFile>('replay-24h.json')
const census = ['page1', 'page2'].flatMap(page => saved<{ residents: Resident[] }>(`residents-presence-${page}.json`).residents)

test('opening now uses every current census room and leaves no replay motion pending', () => {
  const layout = nestedLayout(day.map.places, recordedRoomCapacity(day, census))
  const settled = settleRecordedScene(day, census, layout)
  for (const resident of census) {
    assert.equal(settled.residents.residents[resident.id]?.placeId, resident.current_place_id, `current room for ${resident.id}`)
  }
  assert.equal(settled.residents.pending, false)
  assert.equal(settled.things.pending, false)
  assert.ok(Object.values(settled.residents.residents).every(resident => !resident.walking && !resident.bubble && !resident.sparkle))
  assert.ok(Object.values(settled.things.things).every(thing => !thing.effect))
})

test('a recorded carry cannot overwrite a later floor move or removal when opening now', () => {
  const carry = parseChangesPage(saved('changes-carry-live.json')).events.filter(row => ['99574', '99575'].includes(row.change_id))
  assert.equal(carry.length, 2)
  const person = census.find(resident => resident.id === 262)!
  assert.equal(person.handle, 'lucy')
  const later: ReplayEvent = { actor: 'lucy', at: '2026-09-07T08:31:00.000Z', change_id: '99576', event_id: 99576,
    kind: 'thing_moved', detail: { thing_id: 2727, place_id: 760 } }
  const input: ReplayFile = { ...day, checkpoint: '99576', window_start: carry[0]!.at, window_end: later.at,
    start: { 'resident:262': { place_id: 760 }, 'thing:2727': { place_id: 760 } }, timeline: [...carry, later] }
  const current = [{ ...person, current_place_id: 760 }]
  const layout = nestedLayout(input.map.places, recordedRoomCapacity(input, current))
  const moved = settleRecordedScene(input, current, layout)
  assert.equal(moved.things.things[2727]?.placeId, 760)
  assert.equal(moved.things.things[2727]?.visible, true)
  const removed = settleRecordedScene({ ...input, timeline: [...carry, { ...later, kind: 'thing_withdrawn', detail: { thing_id: 2727 } }] }, current, layout)
  assert.equal(removed.things.things[2727], undefined)
})
