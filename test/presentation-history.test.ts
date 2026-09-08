import assert from 'node:assert/strict'
import test from 'node:test'
import { createTape, playbackCursor, recordFrame, seekFrame, truncateTape } from '../src/presentation-history.ts'

type Frame = {
  residents: Record<number, { x: number, y: number, traits: string[] }>
  clockTime: number
  activity: { lines: string[] }
  places?: Map<number, string>
  selected?: Set<number>
}

const frame = (clockTime: number, x = 1): Frame => ({
  residents: { 1: { x, y: 2, traits: ['quiet'] } },
  clockTime,
  activity: { lines: [`at ${clockTime}`] },
})

test('samples frames and seeks to the last fact at or before the requested time', () => {
  let tape = createTape<Frame>()
  tape = recordFrame(tape, 1_000, frame(1_000))
  tape = recordFrame(tape, 1_100, frame(1_100, 2))
  tape = recordFrame(tape, 1_250, frame(1_250, 3))

  assert.equal(tape.frameCount, 2)
  assert.equal(seekFrame(tape, 1_249)?.frame.clockTime, 1_000)
  assert.equal(seekFrame(tape, 1_999)?.frame.clockTime, 1_250)
  assert.equal(seekFrame(tape, 999), null)
})

test('rewinds at 30x and clamps every playback mode to recorded history', () => {
  let tape = createTape<Frame>()
  tape = recordFrame(tape, 10_000, frame(10_000))
  tape = recordFrame(tape, 70_000, frame(70_000))

  assert.deepEqual(playbackCursor(tape, 50_000, 1_000, 'rewind'), { time: 20_000, atHead: false, atStart: false })
  assert.deepEqual(playbackCursor(tape, 20_000, 1_000, 'rewind'), { time: 10_000, atHead: false, atStart: true })
  assert.deepEqual(playbackCursor(tape, 50_000, 1_000, 'normal'), { time: 51_000, atHead: false, atStart: false })
  assert.deepEqual(playbackCursor(tape, 50_000, 1_000, 'fast'), { time: 70_000, atHead: true, atStart: false })
  assert.deepEqual(playbackCursor(tape, 50_000, 1_000, 'pause'), { time: 50_000, atHead: false, atStart: false })
})

test('captures nested arrays, maps, and sets without retaining caller mutations', () => {
  const source = frame(1_000)
  source.places = new Map([[1, 'square']])
  source.selected = new Set([1])
  let tape = recordFrame(createTape<Frame>(), 1_000, source)
  source.residents[1]!.traits.push('changed')
  source.places.set(2, 'late')
  source.selected.add(2)

  const first = seekFrame(tape, 1_000)!.frame
  assert.deepEqual(first.residents[1]!.traits, ['quiet'])
  assert.deepEqual([...first.places!], [[1, 'square']])
  assert.deepEqual([...first.selected!], [1])

  first.residents[1]!.traits.push('reader mutation')
  first.places!.set(3, 'reader mutation')
  assert.deepEqual(seekFrame(tape, 1_000)!.frame.residents[1]!.traits, ['quiet'])
  assert.equal(seekFrame(tape, 1_000)!.frame.places!.has(3), false)
})

test('rejects invalid or regressing times and leaves the old tape unchanged', () => {
  const empty = createTape<Frame>()
  const recorded = recordFrame(empty, 1_000, frame(1_000))
  assert.equal(empty.frameCount, 0)
  assert.throws(() => recordFrame(recorded, 999, frame(999)), /must not regress/)
  assert.throws(() => recordFrame(recorded, Number.NaN, frame(2_000)), /finite/)
  assert.throws(() => playbackCursor(recorded, 1_000, -1, 'normal'), /non-negative/)
})

test('can force an exact head capture and discard the future before resuming', () => {
  let tape = createTape<Frame>()
  tape = recordFrame(tape, 1_000, frame(1_000))
  tape = recordFrame(tape, 1_100, frame(1_100, 2), { force: true })
  tape = recordFrame(tape, 1_350, frame(1_350, 3))
  assert.equal(tape.frameCount, 3)

  const resumed = truncateTape(tape, 1_100)
  assert.equal(resumed.frameCount, 2)
  assert.equal(resumed.endTime, 1_100)
  assert.equal(seekFrame(resumed, 9_999)?.frame.residents[1]!.x, 2)
  assert.equal(tape.endTime, 1_350)
})

test('stores a mostly still synthetic hour in bounded checkpoints and deltas', () => {
  let tape = createTape<Frame>({ sampleIntervalMs: 250, checkpointIntervalMs: 10_000 })
  const residents = Object.fromEntries(Array.from({ length: 315 }, (_, id) => [id, { x: id, y: 0, traits: ['still'] }]))
  for (let time = 0; time <= 3_600_000; time += 250) {
    const active = time / 250 % 315
    const next = { ...residents, [active]: { ...residents[active]!, x: residents[active]!.x + time / 250 } }
    tape = recordFrame(tape, time, { residents: next, clockTime: time, activity: { lines: [] } })
  }
  assert.equal(tape.frameCount, 14_401)
  assert.ok(tape.checkpointCount <= 361)
  assert.equal(seekFrame(tape, 3_599_999)?.time, 3_599_750)
})
