import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stageFindFreeSpots } from '../src/ground/stage-ground.ts'
import { nestedLayout, type NestedLayout, type Place, type Point, type Room } from '../src/ground/nested.ts'
import { pointAlongPath, sidestepPath, walkPath } from '../src/ground/path.ts'

const overlaps = (a: Room, b: Room): boolean => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

const doorWall = (room: Room): string => {
  const { x, y, width, height, door } = room
  if (door.x === x && door.y === y + height / 2) return 'left'
  if (door.x === x + width && door.y === y + height / 2) return 'right'
  if (door.y === y && door.x === x + width / 2) return 'top'
  if (door.y === y + height && door.x === x + width / 2) return 'bottom'
  assert.fail(`Door ${room.id} must be halfway along its own wall`)
}

test('free spots remain deterministic salvage', () => {
  const entries = Object.freeze(Array.from({ length: 3 }, (_, index) => Object.freeze({ key: `resident:${String(index)}`, kind: 'resident' as const })))
  const room = Object.freeze({ x: 0, y: 0, width: 240, height: 190 })
  const first = stageFindFreeSpots(entries, room)
  assert.deepEqual(stageFindFreeSpots(Object.freeze([...entries].reverse()), room), first)
  assert.equal(Object.keys(first).length, entries.length)
})

test('free positions stay continuous and retain a moved presentation spot', () => {
  const room = Object.freeze({ x: 0, y: 0, width: 220, height: 180 })
  const entries = Object.freeze([
    Object.freeze({ key: 'resident:19', kind: 'resident' as const }),
    Object.freeze({ key: 'thing:7', kind: 'thing' as const }),
    Object.freeze({ key: 'resident:2', kind: 'resident' as const }),
  ])
  const opening = stageFindFreeSpots(entries, room)
  const moved = Object.freeze({
    ...opening,
    'resident:19': Object.freeze({ ...opening['resident:19']!, x: 90, y: 100 }),
  })
  const retained = stageFindFreeSpots(entries, room, moved)
  assert.deepEqual(retained['resident:19'], moved['resident:19'])
  assert.ok(Object.values(opening).some(spot => spot.x % 48 !== 16 || spot.y % 48 !== 16),
    'new arrivals choose continuous coordinates rather than assigned cells')
  assert.ok(Object.values(retained).every(spot => !('row' in spot) && !('column' in spot)))
})

test('fixed obstacles spanning multiple buckets block every overlapping candidate', () => {
  const previous = { 'thing:1': { key: 'thing:1', kind: 'thing' as const, x: 96, y: 96, width: 32, height: 32 } }
  const obstacle = { key: 'resident:1', kind: 'resident' as const, x: 47, y: 47, width: 56, height: 56 }

  assert.deepEqual(stageFindFreeSpots([{ key: 'thing:1', kind: 'thing' }],
    { x: 0, y: 0, width: 160, height: 160 }, previous, [], [obstacle]), {})
})

test('nested layout keeps children inside parents without sibling overlap', () => {
  const places: readonly Place[] = Object.freeze([
    { id: 1, parent_id: null, name: 'world', quiet: false }, { id: 2, parent_id: 1, name: 'north', quiet: false },
    { id: 3, parent_id: 1, name: 'south', quiet: true }, { id: 4, parent_id: 2, name: 'deep', quiet: false },
    { id: 5, parent_id: 2, name: 'deep two', quiet: false },
  ])
  const layout = nestedLayout(places, Object.freeze({ 2: 17 }))
  assert.equal(layout.rootId, 1)
  assert.deepEqual(layout.rooms[1]?.children, [2, 3])
  assert.equal(layout.rooms[3]?.quiet, true)
  assert.ok((layout.rooms[2]?.standing.height ?? 0) >= 90)
  assert.deepEqual(places.map(place => place.id), [1, 2, 3, 4, 5])
  for (const parent of Object.values(layout.rooms)) {
    const children = parent.children.map(id => layout.rooms[id]!)
    for (const [index, child] of children.entries()) {
      assert.ok(child.x >= parent.x && child.y >= parent.y && child.x + child.width <= parent.x + parent.width && child.y + child.height <= parent.y + parent.height)
      doorWall(child)
      for (const sibling of children.slice(index + 1)) assert.equal(overlaps(child, sibling), false)
    }
  }
})

test('doors repeat on reload and successive siblings by id differ, with all four walls in each group of four', () => {
  // Spaced ids ensure variety does not depend on consecutive ids or their remainder.
  const places = [{ id: 1, parent_id: null }, ...Array.from({ length: 12 }, (_, index) => ({ id: (index + 1) * 8, parent_id: 1 }))]
  const capacity = { 8: 25, 32: 4, 64: 10 }
  const layout = nestedLayout(places, capacity)
  assert.deepEqual(nestedLayout(JSON.parse(JSON.stringify(places)), { ...capacity }), layout)
  assert.deepEqual(nestedLayout([...places].reverse(), capacity), layout)
  for (const room of Object.values(layout.rooms)) doorWall(room)
  const walls = layout.rooms[1]!.children.map(id => doorWall(layout.rooms[id]!))
  for (let index = 1; index < walls.length; index += 1) assert.notEqual(walls[index], walls[index - 1])
  for (let index = 0; index <= walls.length - 4; index += 1) assert.equal(new Set(walls.slice(index, index + 4)).size, 4)
})

test('standing floor fits every declared occupant with spare choices', () => {
  const layout = nestedLayout([{ id: 1, parent_id: null, name: 'world', quiet: false }], { 1: 50 })
  const entries = Object.freeze(Array.from({ length: 50 }, (_, index) => Object.freeze({ key: `resident:${String(index)}`, kind: 'resident' as const })))
  const spots = stageFindFreeSpots(entries, layout.rooms[1]!.standing)
  assert.equal(Object.keys(spots).length, entries.length)
})

test('real, wide, and depth-16 maps remain finite and compact', async () => {
  const replay = JSON.parse(await readFile(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as { map: { places: readonly Place[] } }
  const real = nestedLayout(replay.map.places)
  assert.equal(Object.keys(real.rooms).length, replay.map.places.length)
  assert.ok(real.width > 0 && real.height > 0 && real.width < 1_000_000 && real.height < 1_000_000)
  const wide: Place[] = [{ id: 1, parent_id: null, name: 'root', quiet: false }]
  for (let id = 2; id <= 226; id += 1) wide.push({ id, parent_id: 1, name: String(id), quiet: false })
  const wideLayout = nestedLayout(wide)
  assert.ok(wideLayout.width / wideLayout.height < 4 && wideLayout.height / wideLayout.width < 4)
  const deep: Place[] = [{ id: 1, parent_id: null, name: 'root', quiet: false }]
  for (let id = 2; id <= 16; id += 1) deep.push({ id, parent_id: id - 1, name: String(id), quiet: false })
  const deepLayout = nestedLayout(deep)
  assert.equal(deepLayout.rooms[16]?.depth, 15)
  assert.ok(Number.isFinite(deepLayout.width + deepLayout.height))
})

test('layout rejects maps that cannot form one tree', () => {
  assert.throws(() => nestedLayout([]), /root/i)
  assert.throws(() => nestedLayout([{ id: 1, parent_id: null, name: 'one', quiet: false }, { id: 2, parent_id: null, name: 'two', quiet: false }]), /one root/i)
  assert.throws(() => nestedLayout([{ id: 1, parent_id: null, name: 'one', quiet: false }, { id: 2, parent_id: 99, name: 'lost', quiet: false }]), /parent/i)
})

const crosses = (a: { x: number; y: number }, b: { x: number; y: number }, room: Room): boolean => {
  if (a.x === b.x) return a.x > room.x && a.x < room.x + room.width && Math.max(Math.min(a.y, b.y), room.y) < Math.min(Math.max(a.y, b.y), room.y + room.height)
  if (a.y === b.y) return a.y > room.y && a.y < room.y + room.height && Math.max(Math.min(a.x, b.x), room.x) < Math.min(Math.max(a.x, b.x), room.x + room.width)
  return true
}

const touchesRectangle = (a: Point, b: Point, room: Room): boolean =>
  Math.max(a.x, b.x) >= room.x && Math.min(a.x, b.x) <= room.x + room.width &&
  Math.max(a.y, b.y) >= room.y && Math.min(a.y, b.y) <= room.y + room.height

function assertWallCrossings(a: Point, b: Point, room: Room): void {
  if (a.x === b.x) {
    for (const y of [room.y, room.y + room.height]) {
      if (a.x >= room.x && a.x <= room.x + room.width && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) {
        assert.deepEqual({ x: a.x, y }, room.door, `walk crosses room ${room.id} away from its door`)
      }
    }
  } else {
    for (const x of [room.x, room.x + room.width]) {
      if (a.y >= room.y && a.y <= room.y + room.height && x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x)) {
        assert.deepEqual({ x, y: a.y }, room.door, `walk crosses room ${room.id} away from its door`)
      }
    }
  }
}

test('all door directions route both ways over floor on uneven rows and through nested rooms', () => {
  const places: Place[] = [{ id: 1, parent_id: null },
    ...Array.from({ length: 12 }, (_, index) => ({ id: index + 2, parent_id: 1 })),
    ...Array.from({ length: 8 }, (_, index) => ({ id: index + 20, parent_id: 2 + Math.floor(index / 2) })),
  ]
  const layout = nestedLayout(places, { 2: 20, 4: 5, 7: 50, 9: 8, 12: 30, 20: 14, 23: 5 })
  const rooms = Object.values(layout.rooms)
  assert.equal(new Set(rooms.map(doorWall)).size, 4)
  const ancestors = (room: Room): number[] => room.parentId === null ? [room.id] : [room.id, ...ancestors(layout.rooms[room.parentId]!)]
  for (const from of rooms) for (const to of rooms) {
    const start = { x: from.standing.x + from.standing.width * 0.79, y: from.standing.y + from.standing.height * 0.83 }
    const end = { x: to.standing.x + to.standing.width * 0.24, y: to.standing.y + to.standing.height * 0.31 }
    const path = walkPath(layout, from.id, to.id, start, end)
    assert.deepEqual(path[0], start)
    assert.deepEqual(path.at(-1), end)
    const fromChain = ancestors(from)
    const toChain = ancestors(to)
    const lca = fromChain.find(id => toChain.includes(id))!
    const crossedIds = [...fromChain.slice(0, fromChain.indexOf(lca)), ...toChain.slice(0, toChain.indexOf(lca))]
    const allowed = new Set([...fromChain, ...toChain])
    for (const id of crossedIds) assert.ok(path.some(point => point.x === layout.rooms[id]!.door.x && point.y === layout.rooms[id]!.door.y), `missing door ${id}`)
    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1]!
      const b = path[index]!
      assert.ok(a.x === b.x || a.y === b.y, 'every segment is horizontal or vertical')
      assert.ok(b.x > 0 && b.y > 0 && b.x < layout.width && b.y < layout.height, 'walk stays inside the world')
      for (const room of rooms) {
        if (!allowed.has(room.id)) assert.equal(touchesRectangle(a, b, room), false, `${from.id}→${to.id} touches third room ${room.id}`)
        else assertWallCrossings(a, b, room)
      }
    }
  }
})

test('walk paths cross each tree-edge door and avoid unrelated rooms', () => {
  const layout = nestedLayout([
    { id: 1, parent_id: null, name: 'world', quiet: false }, { id: 2, parent_id: 1, name: 'a', quiet: false },
    { id: 3, parent_id: 1, name: 'b', quiet: false }, { id: 4, parent_id: 2, name: 'deep', quiet: false },
    { id: 5, parent_id: 3, name: 'other deep', quiet: false }, { id: 6, parent_id: 1, name: 'obstacle', quiet: false },
  ])
  const start = { x: layout.rooms[4]!.standing.x + 8, y: layout.rooms[4]!.standing.y + 8 }
  const end = { x: layout.rooms[5]!.standing.x + 8, y: layout.rooms[5]!.standing.y + 8 }
  const path = walkPath(layout, 4, 5, start, end)
  assert.deepEqual(path[0], start)
  assert.deepEqual(path.at(-1), end)
  for (const id of [4, 2, 3, 5]) assert.ok(path.some(point => point.x === layout.rooms[id]!.door.x && point.y === layout.rooms[id]!.door.y), `missing door ${String(id)}`)
  for (let index = 1; index < path.length; index += 1) assert.equal(crosses(path[index - 1]!, path[index]!, layout.rooms[6]!), false)
})

test('every recorded applied move follows actual tree doors without entering sibling rooms', async () => {
  const replay = JSON.parse(await readFile(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as {
    map: { places: readonly Place[] }
    timeline: readonly { actor: string; detail?: { action?: string; status?: string; from_place_id?: number; to_place_id?: number } }[]
  }
  const layout = nestedLayout(replay.map.places)
  const ancestors = (id: number): number[] => {
    const result: number[] = []
    let room = layout.rooms[id]
    while (room) {
      result.push(room.id)
      room = room.parentId === null ? undefined : layout.rooms[room.parentId]
    }
    return result
  }
  let routed = 0
  let homes = 0
  for (const event of replay.timeline) {
    const detail = event.detail
    if (detail?.status !== 'applied' || (detail.action !== 'move' && detail.action !== 'go_home') ||
      detail.from_place_id === undefined || detail.to_place_id === undefined) continue
    const from = layout.rooms[detail.from_place_id]!
    const to = layout.rooms[detail.to_place_id]!
    const fromAncestors = ancestors(from.id)
    const toAncestors = ancestors(to.id)
    const lca = fromAncestors.find(id => toAncestors.includes(id))!
    const entered = new Set([...fromAncestors, ...toAncestors])
    const crossedRooms = [
      ...fromAncestors.slice(0, fromAncestors.indexOf(lca)),
      ...toAncestors.slice(0, toAncestors.indexOf(lca)),
    ]
    const start = { x: from.standing.x + from.standing.width * 0.73, y: from.standing.y + from.standing.height * 0.61 }
    const end = { x: to.standing.x + to.standing.width * 0.31, y: to.standing.y + to.standing.height * 0.42 }
    const path = walkPath(layout, from.id, to.id, start, end)
    for (const id of crossedRooms) assert.ok(path.some(point => point.x === layout.rooms[id]!.door.x && point.y === layout.rooms[id]!.door.y), `${detail.action} ${String(from.id)}→${String(to.id)} skipped door ${String(id)}`)
    for (let index = 1; index < path.length; index += 1) {
      for (const room of Object.values(layout.rooms)) {
        if (!entered.has(room.id)) assert.equal(crosses(path[index - 1]!, path[index]!, room), false, `${detail.action} ${String(from.id)}→${String(to.id)} entered sibling ${String(room.id)}`)
        if (room.notch && entered.has(room.id)) assert.equal(crosses(path[index - 1]!, path[index]!, {
          ...room, x: room.x + room.width - room.notch.width, y: room.y + room.height - room.notch.height,
          width: room.notch.width, height: room.notch.height,
        }), false, `route crosses the missing corner of room ${room.id}`)
      }
    }
    routed += 1
    if (detail.action === 'go_home') homes += 1
  }
  assert.ok(routed > 100)
  assert.ok(homes > 0)
})

test('fixture visitor capacities place everyone without collision or omission', async () => {
  const replay = JSON.parse(await readFile(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as {
    map: { places: readonly Place[] }
    start: Readonly<Record<string, { place_id: number }>>
    timeline: readonly { actor: string; detail?: { action?: string; status?: string; to_place_id?: number } }[]
  }
  const visitors = new Map<number, Set<string>>()
  const visit = (placeId: number, key: string): void => {
    visitors.set(placeId, new Set([...(visitors.get(placeId) ?? []), key]))
  }
  for (const [key, state] of Object.entries(replay.start)) if (key.startsWith('resident:')) visit(state.place_id, key)
  for (const event of replay.timeline) {
    if (event.detail?.status === 'applied' && (event.detail.action === 'move' || event.detail.action === 'go_home') && event.detail.to_place_id !== undefined) visit(event.detail.to_place_id, `actor:${event.actor}`)
  }
  const capacities = Object.freeze(Object.fromEntries([...visitors].map(([id, keys]) => [id, keys.size])))
  const layout = nestedLayout(replay.map.places, capacities)
  for (const [id, keys] of visitors) {
    const room = layout.rooms[id]
    if (!room) continue
    const entries = Object.freeze([...keys].map(key => Object.freeze({ key, kind: 'resident' as const })))
    const spots = Object.values(stageFindFreeSpots(entries, room.standing))
    assert.equal(spots.length, entries.length, `place ${String(id)} omitted a visitor`)
    for (const [index, left] of spots.entries()) for (const right of spots.slice(index + 1)) {
      assert.equal(left.x < right.x + right.width + 16 && left.x + left.width + 16 > right.x && left.y < right.y + right.height + 16 && left.y + left.height + 16 > right.y, false, `place ${String(id)} overlaps ${left.key} and ${right.key}`)
    }
  }
})

test('pointAlongPath uses distance, direction, and boundaries', () => {
  const path = Object.freeze([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 10 }])
  assert.deepEqual(pointAlongPath(path, 0), { x: 0, y: 0, flipX: false, done: false })
  assert.deepEqual(pointAlongPath(path, 0.75), { x: -5, y: 10, flipX: true, done: false })
  assert.deepEqual(pointAlongPath(path, 1), { x: -10, y: 10, flipX: true, done: true })
  assert.deepEqual(pointAlongPath([], 0.5), { x: 0, y: 0, flipX: false, done: true })
})

test('a walk takes a small repeatable sidestep around a stationary figure on its floor', () => {
  const sidestepLayout = { rooms: {
    1: { id: 1, parentId: null, name: 'floor', quiet: false, depth: 0, x: 400, y: 0, width: 220, height: 180,
      door: { x: 400, y: 90 }, standing: { x: 420, y: 20, width: 160, height: 130 }, children: [] },
  }, roots: [1], width: 640, height: 460 } as unknown as NestedLayout
  const straight = Object.freeze([{ x: 430, y: 60 }, { x: 570, y: 60 }])
  const blocker = Object.freeze([{ x: 500, y: 60 }])
  const diverted = sidestepPath(sidestepLayout, straight, blocker)

  assert.deepEqual(diverted, [
    { x: 430, y: 60 }, { x: 468, y: 60 }, { x: 468, y: 92 },
    { x: 532, y: 92 }, { x: 532, y: 60 }, { x: 570, y: 60 },
  ])
  assert.deepEqual(straight, [{ x: 430, y: 60 }, { x: 570, y: 60 }])
  assert.deepEqual(sidestepPath(sidestepLayout, straight, [{ x: 500, y: 140 }]), straight)
})

test('one sidestep clears a group and uses the free side of a blocked lane', () => {
  const sidestepLayout = { rooms: {
    1: { id: 1, parentId: null, name: 'floor', quiet: false, depth: 0, x: 350, y: 0, width: 320, height: 240,
      door: { x: 350, y: 120 }, standing: { x: 370, y: 20, width: 280, height: 190 }, children: [] },
  }, roots: [1], width: 700, height: 260 } as unknown as NestedLayout
  const diverted = sidestepPath(sidestepLayout, [{ x: 380, y: 100 }, { x: 640, y: 100 }], [
    { x: 470, y: 100 }, { x: 520, y: 100 }, { x: 470, y: 132 },
  ])
  assert.deepEqual(diverted, [
    { x: 380, y: 100 }, { x: 438, y: 100 }, { x: 438, y: 68 },
    { x: 552, y: 68 }, { x: 552, y: 100 }, { x: 640, y: 100 },
  ])
})
