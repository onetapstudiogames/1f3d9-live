import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { curtainCells, placeFloorArt, roomsToDraw, undrawnFloor } from '../src/room-art.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import type { ReplayFile } from '../src/city/types.ts'

test('place art repeats as a crisp 32 pixel tile across each inner floor', async () => {
  const replay = JSON.parse(await readFile(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
  for (const room of Object.values(nestedLayout(replay.map.places).rooms)) {
    const floor = placeFloorArt(room)
    assert.deepEqual(placeFloorArt(room), floor)
    assert.equal(floor.tileSize, 32)
    assert.equal(floor.cellSize, 4)
    assert.equal(floor.x, room.x + 4)
    assert.equal(floor.y, room.y + 4)
    assert.equal(floor.width, room.width - 8)
    assert.equal(floor.height, room.height - 8)
    assert.equal(floor.tileOffsetX, 4)
    assert.equal(floor.tileOffsetY, 4)
    assert.equal(floor.shadeAlpha, 0.10)
  }
})

test('an undrawn room uses one warm plain floor without an invented grid', () => {
  const floor = undrawnFloor()
  assert.deepEqual(floor, { color: 0xb89b72 })
  assert.equal(Object.isFrozen(floor), true)
  assert.equal(undrawnFloor(), floor, 'the floor choice is stable for every room depth')
})

test('quiet curtains cover the inner floor in bounded, repeatable pixel cells', () => {
  const base = nestedLayout([{ id: 1, parent_id: null, quiet: true }]).rooms[1]!
  for (const room of [base, { ...base, width: 25001, height: 17003 }]) {
    const cells = curtainCells(room, 0x557354)
    assert.equal(cells.length, 64, 'even a large room needs only 64 curtain rectangles')
    assert.deepEqual(curtainCells(room, 0x557354), cells)
    assert.ok(new Set(cells.map(cell => cell.color)).has(0x557354), 'uses the room colour')
    assert.ok(new Set(cells.map(cell => cell.color)).size > 1, 'folds remain visible')
    assert.equal(cells.reduce((area, cell) => area + cell.width * cell.height, 0), (room.width - 8) * (room.height - 8))
    for (const cell of cells) {
      assert.ok([cell.x, cell.y, cell.width, cell.height].every(Number.isInteger))
      assert.ok(cell.width > 0 && cell.height > 0)
      assert.ok(cell.x >= room.x + 4 && cell.y >= room.y + 4)
      assert.ok(cell.x + cell.width <= room.x + room.width - 4)
      assert.ok(cell.y + cell.height <= room.y + room.height - 4)
      assert.equal(Object.isFrozen(cell), true)
    }
    for (let index = 0; index < cells.length; index += 1) {
      const a = cells[index]!
      for (const b of cells.slice(index + 1)) {
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
      }
    }
  }
  assert.deepEqual(curtainCells({ ...base, quiet: false }, 0x557354), [])
})

test('a quiet room keeps its own name and covers the rooms inside it', () => {
  const layout = nestedLayout([
    { id: 1, parent_id: null }, { id: 2, parent_id: 1, name: 'closed', quiet: true },
    { id: 3, parent_id: 2 }, { id: 4, parent_id: 3 }, { id: 5, parent_id: 1 },
  ])
  assert.deepEqual(roomsToDraw(layout).map(room => room.id), [1, 2, 5])
  assert.equal(roomsToDraw(layout)[1]?.name, 'closed')
  const quietWorld = nestedLayout([{ id: 1, parent_id: null, quiet: true }, { id: 2, parent_id: 1 }])
  assert.deepEqual(roomsToDraw(quietWorld).map(room => room.id), [1])
})
