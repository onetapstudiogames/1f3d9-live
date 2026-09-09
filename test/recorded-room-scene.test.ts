import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ReplayFile, Resident } from '../src/city/types.ts'
import { recordedRoomFrames } from './helpers/room-scene.ts'

test('the saved room scene produces byte-identical fake-clock frames through a followed doorway', () => {
  const replay = JSON.parse(readFileSync(new URL('fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
  const census = [1, 2].flatMap(page => (JSON.parse(readFileSync(
    new URL(`fixtures/residents-presence-page${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)
  const before = JSON.stringify({ replay, census })
  const first = recordedRoomFrames(replay, census, '98231')
  assert.equal(first, recordedRoomFrames(replay, census, '98231'))
  assert.equal(JSON.stringify({ replay, census }), before)
  // A checkout with autocrlf rewrites the saved file's newlines; the frames themselves stay byte for byte.
  const saved = readFileSync(new URL('fixtures/room-scene-frames.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.equal(first, saved)
  const frames = JSON.parse(first) as { elapsed: number; roomId: number; resident: { walking: boolean; visible: boolean; placeId: number } }[]
  assert.equal(frames[0]!.roomId, 3)
  assert.ok(frames.some(frame => frame.resident.walking))
  assert.ok(frames.some(frame => frame.roomId === 2 && frame.resident.visible))
  assert.equal(frames.at(-1)!.resident.placeId, 2)
  assert.equal(frames.at(-1)!.resident.walking, false)
})
