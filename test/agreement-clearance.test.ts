import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { agreementSignature, handshakeDuration, handshakeFrame, planHandshake } from '../src/agreements.ts'
import { parseAgreementPair } from '../src/city/agreements.ts'
import { parseChangesPage } from '../src/city/changes.ts'
import { nestedLayout } from '../src/ground/nested.ts'

const read = (file: string) => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'))
const replay = read('replay-24h.json')
const layout = nestedLayout(replay.map.places, { 3: 16 })
const room = layout.rooms[3]!
const row = parseChangesPage(read('changes-agreement-sign.json')).events.find(event => event.change_id === '11273')!
const pair = parseAgreementPair(read('agreements.json'), row)!
const signature = agreementSignature(row, new Map([[row.change_id, pair]]))!

test('both 32-pixel figures keep clear through many meeting angles and return to their reserved spots', () => {
  // The room map and signature are real. These presentation positions are a unit-only
  // scenario; the old public action rows do not establish the parties' historical room.
  const points = [0, 48, 96].flatMap(dx => [0, 48, 96].map(dy => ({ x: room.standing.x + 40 + dx, y: room.standing.y + 40 + dy })))
  for (let a = 0; a < points.length; a += 1) for (let b = a + 1; b < points.length; b += 1) {
    const residents = {
      1: { id: 1, handle: pair.parties[0], placeId: 3, ...points[a]!, visible: true, walking: false, busy: false },
      2: { id: 2, handle: pair.parties[1], placeId: 3, ...points[b]!, visible: true, walking: false, busy: false },
    }
    const before = JSON.stringify(residents)
    const plan = planHandshake(signature, residents, layout, {}, 0)
    assert.ok(plan, `clear presentation pair ${a}/${b} can meet`)
    const duration = handshakeDuration()
    for (let step = 0; step < 100; step += 1) {
      const frame = handshakeFrame(plan, duration * step / 100)!
      assert.ok(Math.max(Math.abs(frame.left.x - frame.right.x), Math.abs(frame.left.y - frame.right.y)) >= 32,
        `32-pixel squares overlap for ${a}/${b} at ${step}`)
      for (const point of [frame.left, frame.right]) {
        assert.ok(point.x >= room.standing.x + 16 && point.x <= room.standing.x + room.standing.width - 16)
        assert.ok(point.y >= room.standing.y + 16 && point.y <= room.standing.y + room.standing.height - 16)
      }
    }
    assert.equal(handshakeFrame(plan, duration), null)
    assert.equal(JSON.stringify(residents), before)
  }
})
