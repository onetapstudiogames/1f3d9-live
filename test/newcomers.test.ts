import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ReplayEvent, ReplayFile } from '../src/city/types.ts'
import type { Point, Room } from '../src/ground/nested.ts'
import {
  newcomerSpot,
  registrationFor,
  sparkleAlpha,
  sparkleFor,
} from '../src/newcomers.ts'
const joinedAt = '2026-09-06T20:55:12.416Z'
const joinedTime = Date.parse(joinedAt)

function event(overrides: Partial<ReplayEvent> = {}): ReplayEvent {
  return {
    actor: 'galaxy-orb',
    at: joinedAt,
    change_id: '98346',
    event_id: 98348,
    kind: 'register',
    detail: { resident_id: 316 },
    ...overrides,
  }
}

function room(overrides: Partial<Room> = {}): Room {
  return {
    id: 195,
    parentId: null,
    name: 'world',
    quiet: false,
    depth: 0,
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    door: { x: 160, y: 180 },
    standing: { x: 24, y: 24, width: 272, height: 90 },
    children: [],
    ...overrides,
  }
}

test('registration facts come only from complete register events', () => {
  assert.deepEqual(registrationFor(event()), { id: 316, handle: 'galaxy-orb', at: joinedTime })
  assert.deepEqual(registrationFor(event({ actor: '  galaxy-orb  ' })), { id: 316, handle: 'galaxy-orb', at: joinedTime })

  const rejected = [
    event({ kind: 'resident_edited' }),
    event({ actor: null }),
    event({ actor: '   ' }),
    event({ at: 'not-a-date' }),
    event({ detail: {} }),
    event({ detail: { resident_id: 0 } }),
    event({ detail: { resident_id: -1 } }),
    event({ detail: { resident_id: 2.5 } }),
    event({ detail: { resident_id: Number.MAX_SAFE_INTEGER + 1 } }),
    event({ detail: { resident_id: '316' } }),
    event({ detail: null } as unknown as Partial<ReplayEvent>),
  ]
  for (const row of rejected) assert.equal(registrationFor(row), null)
})

test('saved replay and census agree on the recorded newcomer date', () => {
  const replay = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
  const census = JSON.parse(readFileSync(new URL('./fixtures/residents-presence-page1.json', import.meta.url), 'utf8')) as {
    residents: readonly { id: number; handle: string | null; joined_at: string }[]
  }
  const registration = replay.timeline.map(registrationFor).find(value => value !== null)
  const resident = census.residents.find(value => value.id === registration?.id)

  assert.deepEqual(registration, { id: 316, handle: 'galaxy-orb', at: joinedTime })
  assert.equal(resident?.handle, registration?.handle)
  assert.equal(Date.parse(resident?.joined_at ?? ''), registration?.at)
})

test('newcomer spots are deterministic id-derived centers on the standing top edge', () => {
  const standingRoom = room()
  const first = newcomerSpot(316, standingRoom, [])
  const second = newcomerSpot(316, standingRoom, [])
  const other = newcomerSpot(317, standingRoom, [])

  assert.deepEqual(second, first)
  assert.notDeepEqual(other, first)
  assert.equal(first?.y, standingRoom.standing.y + 32)
  assert.ok(first !== null && first.x >= standingRoom.standing.x + 32)
  assert.ok(first !== null && first.x <= standingRoom.standing.x + standingRoom.standing.width - 32)
})

test('newcomer spots avoid existing centers by the same 48 pixel clearance', () => {
  const standingRoom = room()
  const opening = newcomerSpot(316, standingRoom, [])!
  const occupied: readonly Point[] = [opening, { x: opening.x + 48, y: opening.y }]
  const next = newcomerSpot(316, standingRoom, occupied)

  assert.ok(next !== null)
  assert.equal(next.y, standingRoom.standing.y + 32)
  assert.equal(occupied.every(point => Math.abs(next.x - point.x) >= 48), true)
})

test('newcomer spots return null when the top edge is full or facts are unsafe', () => {
  const narrow = room({ standing: { x: 10, y: 20, width: 112, height: 90 } })
  assert.equal(newcomerSpot(7, narrow, [{ x: 42, y: 52 }, { x: 90, y: 52 }]), null)

  assert.equal(newcomerSpot(0, room(), []), null)
  assert.equal(newcomerSpot(Number.NaN, room(), []), null)
  assert.equal(newcomerSpot(7, room({ standing: { x: 0, y: 0, width: 63, height: 90 } }), []), null)
  assert.equal(newcomerSpot(7, room({ standing: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 90 } }), []), null)
  assert.equal(newcomerSpot(7, room({ standing: { x: -1, y: 0, width: 100, height: 90 } }), []), null)
  assert.equal(newcomerSpot(7, room(), [{ x: Number.NaN, y: 56 }]), null)
  assert.equal(newcomerSpot(7, room(), [null] as unknown as readonly Point[]), null)
})

test('sparkles last 2.4 seconds', () => {
  assert.deepEqual(sparkleFor(5_000), { shownAt: 5_000, expiresAt: 7_400 })
  assert.equal(sparkleFor(Number.NaN), null)
})

test('sparkle alpha fades linearly and is zero outside valid time', () => {
  const sparkle = sparkleFor(1_000)!
  assert.equal(sparkleAlpha(sparkle, 999), 0)
  assert.equal(sparkleAlpha(sparkle, 1_000), 1)
  assert.equal(sparkleAlpha(sparkle, 2_200), 0.5)
  assert.equal(sparkleAlpha(sparkle, 3_400), 0)
  assert.equal(sparkleAlpha(null, 1_000), 0)
  assert.equal(sparkleAlpha({ shownAt: 2_000, expiresAt: 1_000 }, 1_500), 0)
  assert.equal(sparkleAlpha({ shownAt: Number.NaN, expiresAt: 2_000 }, 1_500), 0)
  assert.equal(sparkleAlpha(sparkle, Number.NaN), 0)
})
