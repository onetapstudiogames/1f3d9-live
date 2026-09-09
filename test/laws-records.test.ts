import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ReplayEvent, ReplayFile, ReplayPlace, Resident } from '../src/city/types.ts'
import { blockedAttemptFor, parseCurrentLaws, parseLawNames } from '../src/laws.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { createResidents, stepResidents } from '../src/replay/simulation.ts'
import { settleRecordedScene } from './helpers/recorded-scene.ts'

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
const events = read('events-scree-laws.json').events as Array<ReplayEvent & { id: number }>

test('effective laws preserve the exact published names and distinguish empty from unknown', () => {
  const bench = read('places/place-97.json').place
  assert.equal(bench.id, 97)
  assert.equal(bench.name, 'the regression bench')
  assert.deepEqual(parseLawNames(bench.laws), ['hospitable', 'marks-its-room', 'remembers-the-second-visit'])
  assert.deepEqual(parseCurrentLaws(bench.laws)?.map(law => law.sourcePlaceId), [97, 97, 97])
  assert.deepEqual(parseLawNames(read('places/place-767.json').place.laws), ['waits-for-a-look'])
  assert.deepEqual(parseLawNames(read('outline-square-laws.json').place.laws), [])
  assert.deepEqual(parseLawNames(read('outline-lab-laws.json').place.laws), [])
  assert.equal(parseLawNames(undefined), null)
  assert.equal(parseLawNames({ damage: true }), null)
  assert.equal(parseLawNames([{}]), null)
})

test('the six real blocked attempts identify scree and move but supply no current countdown', () => {
  const blocked = events.filter(event => blockedAttemptFor(event))
  assert.deepEqual(blocked.map(event => event.id), [84651, 84650, 84649, 84648, 84647, 84641])
  for (const event of blocked) {
    assert.equal(event.kind, 'action')
    assert.equal(event.detail.status, 'blocked')
    assert.equal(blockedAttemptFor(event)?.actor, 'scree')
    assert.equal(blockedAttemptFor(event)?.action, 'move')
    for (const key of ['place_id', 'remaining_seconds', 'seconds', 'expires_at']) {
      assert.equal(Object.hasOwn(event.detail, key), false, key)
    }
  }
  const prior = events.find(event => event.change_id === '84636')!
  assert.equal(prior.actor, 'scree')
  assert.equal(prior.detail.from_place_id, 224)
  assert.equal(prior.detail.to_place_id, 457)
  assert.ok(Date.parse(prior.at) < Date.parse(blocked.at(-1)!.at))
})

test('reference-only effect notices never create a block target or duration', () => {
  for (const file of ['changes-effect-scheduled.json', 'changes-effect-resolved.json']) {
    const answer = read(file)
    assert.equal(answer.returned_items, 200)
    assert.equal(answer.has_more, true)
    for (const row of answer.changes) {
      assert.equal(blockedAttemptFor({ ...row, at: row.created_at, event_id: Number(row.change_id) }), null)
      for (const key of ['resident_id', 'target_id', 'target_type', 'seconds', 'expires_at', 'due_at']) {
        assert.equal(Object.hasOwn(row.detail, key), false, `${file}: ${key}`)
      }
    }
  }
  assert.equal(read('physics-laws.json').effect_bricks.includes('damage'), false)
  const traits = [...read('traits-laws.json').traits, ...read('traits-laws-page2.json').traits]
  assert.equal(read('traits-laws-page2.json').has_more, false)
  assert.equal(traits.some(trait => trait.name === 'damage'), false)
})

test('a blocked law action needs no invented source thing, and error prose is not a blocked status', () => {
  const real = events.find(event => event.id === 84651)!
  // Unit-only variants use the public action shape; no altered answer is served to a browser.
  for (const action of ['talk', 'move', 'use', 'give', 'consume', 'make']) {
    const event = { ...real, detail: { action, status: 'blocked', action_id: real.detail.action_id } }
    assert.equal(blockedAttemptFor(event)?.action, action)
    assert.equal(blockedAttemptFor({ ...event, detail: { ...event.detail, status: 'failed', error: 'blocked' } }), null)
  }
  assert.equal(blockedAttemptFor({ ...real, actor: null }), null)
})

test('all fourteen law evidence answers have byte-identical browser copies', () => {
  const files = ['physics-laws.json', 'traits-laws.json', 'traits-laws-page2.json', 'changes-laws.json',
    'changes-effect-scheduled.json', 'changes-effect-resolved.json', 'events-effect-resolved.json',
    'outline-square-laws.json', 'outline-lab-laws.json', 'places/place-97.json', 'places/place-767.json',
    'events-actions-laws.json', 'events-juniper-laws.json', 'events-scree-laws.json']
  for (const file of files) assert.deepEqual(readFileSync(new URL(`./fixtures/${file}`, import.meta.url)),
    readFileSync(new URL(`../public/fixtures/${file}`, import.meta.url)), file)
})

test('scree arrives before the blocked attempt and waits for its display before the later real walk', () => {
  const enter = events.find(event => event.id === 84638)!
  const blocked = events.find(event => event.id === 84641)!
  const leave = events.find(event => event.id === 84664)!
  const places = read('replay-24h.json').map.places as ReplayPlace[]
  const layout = nestedLayout(places, { 224: 2, 457: 2 })
  const census = ([...read('residents-presence-page1.json').residents,
    ...read('residents-presence-page2.json').residents] as Resident[]).find(row => row.handle === 'scree')!
  assert.equal(census.id, 95)
  assert.equal(leave.detail.from_place_id, enter.detail.to_place_id)
  // A unit scenario with three unchanged public rows, never a browser replay.
  const replay: ReplayFile = { span: '24h', window_start: enter.at, window_end: leave.at,
    checkpoint: leave.change_id, complete: true, row_ceiling: 3, map: { places }, counts: {},
    start: { 'resident:95': { place_id: enter.detail.from_place_id as number } },
    timeline: [enter, blocked, leave].map(row => ({ ...row, event_id: row.id })) }
  let state = stepResidents(createResidents(replay, [census], layout), replay.timeline, 0, 0, layout)
  assert.equal(state.residents[95]!.walking, true)
  assert.equal(state.residents[95]!.blockedAttempt ?? null, null)
  const arrivalAt = state.residents[95]!.walkDuration
  state = stepResidents(state, [], arrivalAt, arrivalAt, layout)
  const held = state.residents[95]!
  assert.equal(held.placeId, 457)
  assert.equal(held.walking, false)
  assert.equal(held.blockedAttempt?.attempt.action, 'move')
  assert.equal(held.queue.length, 1)
  const expires = held.blockedAttempt!.expiresAt
  state = stepResidents(state, [], expires - arrivalAt - 1, expires - 1, layout)
  assert.deepEqual([state.residents[95]!.x, state.residents[95]!.y], [held.x, held.y])
  assert.equal(state.residents[95]!.walking, false)
  state = stepResidents(state, [], 1, expires, layout)
  assert.equal(state.residents[95]!.blockedAttempt ?? null, null)
  assert.equal(state.residents[95]!.walking, true)
  const settled = settleRecordedScene(replay, [census], layout)
  assert.equal(settled.residents.pending, false)
  assert.equal(settled.residents.residents[95]!.blockedAttempt ?? null, null)
})
