import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ReplayFile, Resident } from '../src/city/types.ts'
import { nestedLayout, type Point } from '../src/ground/nested.ts'
import { pointAlongPath, walkPath } from '../src/ground/path.ts'
import { appliedMove } from '../src/replay/index.ts'
import { createResidents, roomCapacity, stepResidents } from '../src/replay/simulation.ts'
import { boatFrame } from '../src/sea.ts'

const replay = JSON.parse(readFileSync(new URL('fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
const census = [1, 2].flatMap(page => (JSON.parse(readFileSync(new URL(
  `fixtures/residents-presence-page${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)
const layout = nestedLayout(replay.map.places, roomCapacity(replay, census))
const event = (id: string) => replay.timeline.find(row => row.change_id === id)!
const distance = (path: readonly Point[]): number => path.slice(1).reduce((sum, to, index) =>
  sum + Math.hypot(to.x - path[index]!.x, to.y - path[index]!.y), 0)

test('Merlin’s recorded world-to-continent move keeps its established route and duration', () => {
  const initial = createResidents(replay, census, layout)
  const id = initial.actors.get('merlin')!
  assert.equal(initial.residents[id]!.placeId, 195)
  const started = stepResidents(initial, [event('98187')], 0, 0, layout)
  const walker = started.residents[id]!
  assert.deepEqual(walker.path, [
    { x: 9834, y: 731 }, { x: 24, y: 731 }, { x: 24, y: 810 },
    { x: 18560, y: 810 }, { x: 18560, y: 20436 }, { x: 18560, y: 20460 },
    { x: 17784, y: 20460 }, { x: 17784, y: 20594 }, { x: 18454, y: 20594 },
  ])
  assert.equal(walker.walkDuration, 3645.0800637753437)
  let state = started
  let boats = 0
  let land = 0
  for (let now = 20; now <= 3800; now += 20) {
    state = stepResidents(state, [], 20, now, layout)
    const resident = state.residents[id]!
    if (!resident.walking) continue
    assert.equal(typeof resident.pathProgress, 'number')
    const frame = boatFrame(layout, resident.path, resident.pathProgress!, resident.visible)
    if (frame) {
      boats += 1
      assert.equal(frame.x, resident.x)
      assert.equal(frame.y, resident.y)
      assert.equal(frame.flipX, resident.flipX)
    } else land += 1
  }
  assert.ok(boats > 0 && land > 0, 'the same recorded move sails, then walks inland')
  assert.equal(state.residents[id]!.walking, false)
  assert.equal(state.residents[id]!.placeId, 224)
  assert.equal(boatFrame(layout, state.residents[id]!.path, 1, true), null)
})

test('recorded homeward routes sail only between continents, never within the mainland', () => {
  for (const [changeId, crossesWater] of [['98272', false], ['98354', true]] as const) {
    const move = appliedMove(event(changeId))!
    const from = layout.rooms[move.fromId]!
    const to = layout.rooms[move.toId]!
    // Fixed room coordinates are presentation; only these endpoints come from the row.
    const path = walkPath(layout, from.id, to.id, from.standing, to.standing)
    const before = JSON.stringify(path)
    const total = distance(path)
    let preceding = 0
    let water = 0
    let land = 0
    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1]!
      const b = path[index]!
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      const progress = (preceding + length / 2) / total
      preceding += length
      if (!length) continue
      const frame = boatFrame(layout, path, progress, true)
      if (frame) {
        water += 1
        const point = pointAlongPath(path, progress)
        assert.equal(frame.x, point.x)
        assert.equal(frame.y, point.y)
        assert.equal(frame.flipX, point.flipX, 'vertical water segments keep the resident’s last facing')
        for (const childId of layout.rooms[layout.rootId]!.children) {
          const room = layout.rooms[childId]!
          assert.ok(frame.x < room.x || frame.x > room.x + room.width ||
            frame.y < room.y || frame.y > room.y + room.height)
        }
        assert.equal(boatFrame(layout, path, progress, false), null, 'concealed figures never gain a boat')
      } else land += 1
    }
    assert.equal(water > 0, crossesWater)
    assert.ok(land > 0)
    assert.equal(JSON.stringify(path), before, 'classifying water never rewrites the route')
  }
})
