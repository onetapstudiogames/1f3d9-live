import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { drawingCells } from '../src/city/drawing.ts'
import { initialResidents } from '../src/city/residents.ts'
import { sleepingDrawingCells, sleepingResidents } from '../src/sleep.ts'
import type { CensusPage, Drawing, ReplayEvent, ReplayFile, Resident } from '../src/city/types.ts'

const baseReplay = {
  window_start: '2026-09-06T20:00:00Z',
  start: {},
  timeline: [],
} as unknown as ReplayFile

function resident(overrides: Partial<Resident> = {}): Resident {
  return {
    id: 7,
    handle: 'sleeper',
    model: '',
    joined_at: '2026-09-06T19:00:00Z',
    has_drawing: false,
    current_place_id: 12,
    asleep: true,
    ...overrides,
  }
}

function event(actor: string, at = '2026-09-06T20:01:00Z'): ReplayEvent {
  return { actor, at, change_id: '1', event_id: 1, kind: 'action', detail: { action: 'move' } }
}

test('marks only an asleep resident whose unchanged census position is valid at window start', () => {
  assert.deepEqual([...sleepingResidents(baseReplay, [resident({ joined_at: baseReplay.window_start })])], [7])
})

const fullDrawing = {
  id: 7,
  type: 'resident',
  state: 'complete',
  drawing: {
    palette: ['#112233', '#abcdef', '#ff0044', '#00cc77'],
    indices: Array.from({ length: 64 }, (_, i) => i % 4),
  },
} as Drawing

for (const [name, drawing] of [['the default figure', null], ['a full 64 cell drawing', fullDrawing]] as const) {
  test(`the sleeping pose keeps every painted pixel and colour of ${name}`, () => {
    const standing = drawingCells(drawing)
    const cells = sleepingDrawingCells(drawing)

    assert.equal(cells.length, standing.length)
    assert.deepEqual(new Set(cells.map(cell => cell.color)), new Set(standing.map(cell => cell.color)))
    assert.deepEqual(countByColor(cells), countByColor(standing))
  })

  test(`the sleeping pose gives ${name} one cell each inside the 8 by 8 grid`, () => {
    const cells = sleepingDrawingCells(drawing)
    const seats = new Set(cells.map(cell => `${cell.x},${cell.y}`))

    assert.equal(seats.size, cells.length)
    assert.equal(cells.every(cell => Number.isInteger(cell.x) && cell.x >= 0 && cell.x < 8), true)
    assert.equal(cells.every(cell => Number.isInteger(cell.y) && cell.y >= 0 && cell.y < 8), true)
  })
}

test('the default figure lies down, wider than it is tall, head to the left', () => {
  const standing = drawingCells(null)
  const cells = sleepingDrawingCells(null)
  const span = (values: readonly number[]) => Math.max(...values) - Math.min(...values) + 1
  const headColor = 0x5b3b24

  assert.equal(span(standing.map(cell => cell.y)) > span(standing.map(cell => cell.x)), true)
  assert.equal(span(cells.map(cell => cell.x)) > span(cells.map(cell => cell.y)), true)
  assert.equal(cells.filter(cell => cell.color === headColor).every(cell => cell.x <= 3), true)
})

test('the sleeping turn maps an asymmetric top-right cell to the top-left', () => {
  const indices = Array<null | number>(64).fill(null)
  indices[7] = 0
  const drawing = {
    id: 7,
    type: 'resident',
    state: 'complete',
    drawing: { palette: ['#123456'], indices },
  } as Drawing

  assert.deepEqual(sleepingDrawingCells(drawing), [{ x: 0, y: 0, color: 0x123456 }])
})

function countByColor(cells: readonly { color: number }[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const cell of cells) counts.set(cell.color, (counts.get(cell.color) ?? 0) + 1)
  return counts
}

test('any replay start entry rejects sleep, including an explicit null entry', () => {
  const placed = { ...baseReplay, start: { 'resident:7': { place_id: 12 } } }
  const unplaced = { ...baseReplay, start: { 'resident:7': null } }
  assert.equal(sleepingResidents(placed, [resident()]).has(7), false)
  assert.equal(sleepingResidents(unplaced, [resident()]).has(7), false)
})

test('any event by the handle rejects sleep, including speech and an unreadable later timestamp', () => {
  for (const row of [
    event('sleeper'),
    { ...event('sleeper'), kind: 'note', at: 'not-a-time' },
    { ...event('sleeper'), kind: 'resident_edited', at: '2999-01-01T00:00:00Z' },
  ]) {
    assert.equal(sleepingResidents({ ...baseReplay, timeline: [row] }, [resident()]).has(7), false)
  }
})

test('late joins and unknown or missing facts remain standing', () => {
  const unsafe: readonly Resident[] = [
    resident({ id: 1, joined_at: '2026-09-06T20:00:00.001Z' }),
    resident({ id: 2, joined_at: 'unknown' }),
    resident({ id: 3, handle: null }),
    resident({ id: 4, handle: '   ' }),
    resident({ id: 5, current_place_id: null }),
    resident({ id: 6, asleep: false }),
    { ...resident({ id: 8 }), asleep: undefined } as unknown as Resident,
    { ...resident({ id: 9 }), joined_at: undefined } as unknown as Resident,
    { ...resident({ id: 10 }), current_place_id: '12' } as unknown as Resident,
  ]
  assert.deepEqual([...sleepingResidents(baseReplay, unsafe)], [])
  assert.deepEqual([...sleepingResidents({ ...baseReplay, window_start: 'unknown' }, [resident()])], [])
})

test('saved city fixtures yield only drawable conservative sleep candidates', () => {
  const replay = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
  const page1 = JSON.parse(readFileSync(new URL('./fixtures/residents-presence-page1.json', import.meta.url), 'utf8')) as CensusPage
  const page2 = JSON.parse(readFileSync(new URL('./fixtures/residents-presence-page2.json', import.meta.url), 'utf8')) as CensusPage
  const census = [...page1.residents, ...page2.residents]
  const sleeping = sleepingResidents(replay, census)
  const drawn = new Set(initialResidents(replay, census).map(item => item.id))

  assert.equal(sleeping.size, 131)
  assert.equal(sleeping.has(244), true)
  assert.equal([...sleeping].every(id => drawn.has(id)), true)
})
