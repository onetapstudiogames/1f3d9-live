import assert from 'node:assert/strict'
import test from 'node:test'
import { readCurrentUpdate } from '../src/current-read.ts'
import type { ReplayEvent } from '../src/city/types.ts'
import type { LiveReadState } from '../src/live.ts'

const state: LiveReadState = { marker: '10', seen: new Set(), failures: 0, lastReadAt: 0 }
const move: ReplayEvent = { change_id: '11', event_id: 11, actor: 'walker', kind: 'action',
  at: '2026-09-08T12:00:00Z', detail: { action: 'move', status: 'applied', from_place_id: 2, to_place_id: 3 } }

test('a move arriving during the current read is witnessed in that same refresh exactly once', async () => {
  let finishSnapshot!: (snapshot: number) => void
  let recorded = false
  const reads: string[] = []
  const readChanges = async (since: string) => {
    reads.push(`changes:${since}`)
    assert.equal(recorded, true)
    return { marker: '11', nextSince: '11', hasMore: false, unchanged: since === '11',
      events: since === '11' ? [] : [move] }
  }
  const pending = readCurrentUpdate(state, () => {
    reads.push('presence')
    return new Promise<number>(resolve => { finishSnapshot = resolve })
  }, readChanges, () => 100)
  assert.deepEqual(reads, ['presence'])
  recorded = true
  finishSnapshot(3)
  const first = await pending
  assert.equal(first.snapshot, 3)
  assert.deepEqual(first.events, [move])
  assert.deepEqual(reads, ['presence', 'changes:10'])
  const second = await readCurrentUpdate(first.state, async () => 3, readChanges, () => 200)
  assert.deepEqual(second.events, [])
  assert.equal(state.marker, '10')
})

test('a failed current snapshot neither reads nor advances the change cursor', async () => {
  let feedReads = 0
  await assert.rejects(readCurrentUpdate(state, async () => { throw new Error('presence unavailable') },
    async () => { feedReads += 1; throw new Error('unexpected feed read') }, () => 100), /presence unavailable/)
  assert.equal(feedReads, 0)
  assert.equal(state.marker, '10')
})
