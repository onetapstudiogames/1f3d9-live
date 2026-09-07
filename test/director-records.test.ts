import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ReplayFile } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { roomsToDraw } from '../src/room-art.ts'
import { hiddenRooms, planPlaces } from '../src/places.ts'
import { directorActivity, rankDirectorRooms } from '../src/director.ts'

const replay = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
const layout = nestedLayout(replay.map.places)
const eligible = new Set(roomsToDraw(layout).filter(room => !room.quiet).map(room => room.id))
const end = Date.parse(replay.window_end)
const hidden = hiddenRooms(planPlaces(replay), layout, end)

test('the actual final five minutes rank recorded moves and notes without counting either twice', () => {
  const activity = directorActivity(replay.timeline, end)
  assert.deepEqual(activity.map(row => row.changeId), Array.from({ length: 15 }, (_, index) => String(98971 + index)))
  assert.deepEqual(rankDirectorRooms(activity, eligible, hidden), [1, 2, 8, 119, 195, 347, 780, 363])
  assert.deepEqual(directorActivity([...replay.timeline, ...replay.timeline], end), activity)
  assert.deepEqual(directorActivity(replay.timeline, end + 300001), [])
})

test('all actual plain things count as creations even though their kind id is null', () => {
  const creations = replay.timeline.filter(row => row.kind === 'thing_created')
  assert.equal(creations.length, 9)
  for (const row of creations) {
    assert.equal(row.detail.kind_id, null)
    assert.deepEqual(directorActivity([row], Date.parse(row.at)), [{ changeId: row.change_id, placeId: row.detail.place_id }])
    assert.deepEqual(directorActivity([row], Date.parse(row.at) - 1), [])
  }
})

test('concealed or ineligible rooms never inherit a place in the director ranking', () => {
  const activity = directorActivity(replay.timeline, end)
  const concealed = new Set([1, 2, 8, 119, 195, 347, 780, 363])
  assert.deepEqual(rankDirectorRooms(activity, eligible, concealed), [])
  assert.deepEqual(rankDirectorRooms(activity, new Set(), hidden), [])
})

test('actual homeward walks count, while a failed return and a same-room return do not', () => {
  const walk = replay.timeline.find(row => row.change_id === '98272')!
  assert.equal(walk.detail.action, 'go_home')
  assert.deepEqual(directorActivity([walk], Date.parse(walk.at)), [{ changeId: '98272', placeId: 193 }])
  for (const id of ['98343', '98586']) {
    const still = replay.timeline.find(row => row.change_id === id)!
    assert.deepEqual(directorActivity([still], Date.parse(still.at)), [])
  }
})
