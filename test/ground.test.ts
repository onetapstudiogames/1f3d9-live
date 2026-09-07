import test from 'node:test'
import assert from 'node:assert/strict'
import {
  stageBuildCorridorGraph,
  stageChildPlaces,
  stageExpandedGroundLayout,
  stageFindFreeSpots,
  stageQuietRoom,
  stageRoomLayout,
  stageShortestPath,
  stageStandingRoomHeight,
} from '../src/ground/stage-ground.ts'

// Ported from the city's test/window-live-client.test.ts on branch feat/live-stage-ground.
// If a case below references a helper this file does not define, port it from that file.

test('room ground is append-stable and a founded room takes fresh parent-edge ground', () => {
  const places = Object.freeze([
    Object.freeze({ id: 1, parent_id: null, name: 'the square' }),
    Object.freeze({ id: 4, parent_id: 1, name: 'first room' }),
    Object.freeze({ id: 9, parent_id: 1, name: 'second room' }),
  ])
  const founded = Object.freeze([...places,
    Object.freeze({ id: 21, parent_id: 1, name: 'founded room' })])
  const before = stageRoomLayout(places, 1)
  const after = stageRoomLayout(founded, 1)

  assert.deepEqual(stageChildPlaces(places, 1).map(place => place.id), [4, 9])
  assert.deepEqual(after.rooms['4'], before.rooms['4'], 'room 4 rectangle must not move')
  assert.deepEqual(after.rooms['9'], before.rooms['9'], 'room 9 rectangle must not move')
  assert.ok(after.rooms['21'], 'founded room 21 must receive a rectangle')
  assert.equal(after.rooms['21']?.door.side, 'left', 'founded room door faces its parent corridor')
  assert.deepEqual(places.map(place => place.id), [1, 4, 9], 'layout must not mutate the map seed')
})

test('room ground retains coordinates through removal, return, and lower-id founding', () => {
  const parent = Object.freeze({ id: 1, parent_id: null, name: 'the square' })
  const room4 = Object.freeze({ id: 4, parent_id: 1, name: 'first room' })
  const room9 = Object.freeze({ id: 9, parent_id: 1, name: 'second room' })
  const opening = stageRoomLayout(Object.freeze([parent, room4, room9]), 1)
  assert.deepEqual(stageRoomLayout(Object.freeze([room9, parent, room4]), 1), opening,
    'the first survey must be deterministic regardless of input order')
  const afterRemoval = stageRoomLayout(
    Object.freeze([parent, room9]), 1, Object.freeze([]), opening.rooms)

  assert.deepEqual(afterRemoval.rooms['9'], opening.rooms['9'],
    'removing an earlier room must not shift a surviving room')

  const lateRoom = Object.freeze({ id: 2, parent_id: 1, name: 'late lower-id room' })
  const afterFounding = stageRoomLayout(
    Object.freeze([parent, lateRoom, room9]), 1, Object.freeze([]), opening.rooms)
  assert.deepEqual(afterFounding.rooms['9'], opening.rooms['9'],
    'a late lower id must not shift an existing room')
  assert.notDeepEqual(afterFounding.rooms['2'], opening.rooms['4'],
    'a new room must not reuse a missing room coordinate')

  const roomHistory = Object.freeze({ ...opening.rooms, ...afterFounding.rooms })
  const afterReturn = stageRoomLayout(
    Object.freeze([parent, lateRoom, room4, room9]), 1, Object.freeze([]), roomHistory)
  assert.deepEqual(afterReturn.rooms['4'], opening.rooms['4'],
    'a returning room must reclaim its historical coordinate')
  assert.deepEqual(afterReturn.rooms['9'], opening.rooms['9'])
  assert.deepEqual(afterReturn.rooms['2'], afterFounding.rooms['2'])
})

test('a full room takes fresh parent-edge standing ground without moving room boxes', () => {
  const places = Object.freeze([
    Object.freeze({ id: 1, parent_id: null, name: 'the square' }),
    Object.freeze({ id: 4, parent_id: 1, name: 'first room' }),
    Object.freeze({ id: 9, parent_id: 1, name: 'second room' }),
  ])
  const layout = stageRoomLayout(places, 1)
  const before = structuredClone(layout.rooms)
  const expansions = Object.freeze([
    Object.freeze({ id: 4, residentHeight: 896, thingHeight: 320 }),
    Object.freeze({ id: 9, residentHeight: 0, thingHeight: 320 }),
  ])
  const expanded = stageExpandedGroundLayout(Object.values(layout.rooms), expansions)

  assert.deepEqual(layout.rooms, before, 'allocating standing ground must not move a room box')
  const fixed = Object.values(layout.rooms).map(room => ({
    id: String(room.id), x: room.x, y: room.y, width: room.width, height: room.height + 64,
  }))
  const regions = Object.entries(expanded.grounds).flatMap(([id, ground]) =>
    ground.regions.map((region, index) => ({ id: `${id}:${index}`, ...region })))
  for (const region of regions) {
    assert.ok(region.y + region.height <= expanded.height,
      `${region.id} must fit inside height ${expanded.height}: ${JSON.stringify(region)}`)
    for (const obstacle of [...fixed, ...regions.filter(other => other.id < region.id)]) {
      const overlaps = region.x < obstacle.x + obstacle.width &&
        region.x + region.width > obstacle.x &&
        region.y < obstacle.y + obstacle.height &&
        region.y + region.height > obstacle.y
      assert.equal(overlaps, false,
        `${region.id} ${JSON.stringify(region)} must clear ${obstacle.id} ${JSON.stringify(obstacle)}`)
    }
  }

  const founded = stageRoomLayout(Object.freeze([
    ...places,
    Object.freeze({ id: 21, parent_id: 1, name: 'founded room' }),
  ]), 1, Object.freeze(regions))
  assert.deepEqual(founded.rooms['4'], layout.rooms['4'])
  assert.deepEqual(founded.rooms['9'], layout.rooms['9'])
  const foundedRoom = founded.rooms['21']!
  for (const region of regions) {
    const overlaps = foundedRoom.x < region.x + region.width &&
      foundedRoom.x + foundedRoom.width > region.x &&
      foundedRoom.y < region.y + region.height &&
      foundedRoom.y + foundedRoom.height > region.y
    assert.equal(overlaps, false,
      `founded room ${JSON.stringify(foundedRoom)} must not move ${region.id} ${JSON.stringify(region)}`)
  }
  const retained = stageExpandedGroundLayout(
    Object.values(founded.rooms), expansions, expanded.grounds)
  assert.deepEqual(retained.grounds, expanded.grounds,
    'founding must retain every allocated extension rectangle')
})

test('resident arrivals choose id-deterministic free standing spots without a cell assignment', () => {
  const room = Object.freeze({ x: 0, y: 0, width: 220, height: 180 })
  const entries = Object.freeze([
    Object.freeze({ key: 'resident:19', kind: 'resident' as const }),
    Object.freeze({ key: 'thing:7', kind: 'thing' as const }),
    Object.freeze({ key: 'resident:2', kind: 'resident' as const }),
  ])
  const opening = stageFindFreeSpots(entries, room)
  const reloaded = stageFindFreeSpots(Object.freeze([...entries].reverse()), room)
  const arrivedWithHistory = stageFindFreeSpots(Object.freeze([
    ...entries,
    Object.freeze({ key: 'resident:11', kind: 'resident' as const }),
  ]), room, opening)
  const otherIdWithSameFreeSpots = stageFindFreeSpots(Object.freeze([
    ...entries,
    Object.freeze({ key: 'resident:12', kind: 'resident' as const }),
  ]), room, opening)
  const movedPresentation = Object.freeze({
    ...opening,
    'resident:19': Object.freeze({ ...opening['resident:19']!, x: 90, y: 100 }),
  })
  const retainedPresentation = stageFindFreeSpots(entries, room, movedPresentation)
  const edgeSpot = Object.freeze({
    key: 'resident:1', kind: 'resident' as const, x: 16, y: 16, width: 32, height: 32,
  })
  const retainedEdgeSpot = stageFindFreeSpots(Object.freeze([
    Object.freeze({ key: 'resident:1', kind: 'resident' as const }),
  ]), room, Object.freeze({ 'resident:1': edgeSpot }))

  assert.deepEqual(reloaded, opening, 'reload placement must depend on ids, not input order')
  assert.notDeepEqual(arrivedWithHistory['resident:11'], otherIdWithSameFreeSpots['resident:12'],
    'different arriving ids must choose from the same free spots differently')
  assert.deepEqual(retainedPresentation['resident:19'], movedPresentation['resident:19'],
    'a free presentation position must not snap back to a hidden cell')
  assert.deepEqual(retainedEdgeSpot['resident:1'], edgeSpot,
    'half a sprite of edge clearance is a valid occupied position')
  for (const key of Object.keys(opening)) {
    assert.deepEqual(arrivedWithHistory[key], opening[key],
      `${key} must remain occupied while resident 11 arrives`)
  }
  assert.deepEqual(entries.map(entry => entry.key), ['resident:19', 'thing:7', 'resident:2'])
  assert.ok(Object.values(arrivedWithHistory).every(spot =>
    !('row' in spot) && !('column' in spot)), 'standing spots must not expose a cell grid')

  const spots = Object.values(arrivedWithHistory)
  for (const [index, left] of spots.entries()) {
    assert.ok(left.x >= room.x && left.y >= room.y &&
      left.x + left.width <= room.x + room.width &&
      left.y + left.height <= room.y + room.height,
    `${left.key} ${JSON.stringify(left)} must stay inside ${JSON.stringify(room)}`)
    for (const right of spots.slice(index + 1)) {
      const overlapsWithClearance = left.x < right.x + right.width + 16 &&
        left.x + left.width + 16 > right.x &&
        left.y < right.y + right.height + 16 &&
        left.y + left.height + 16 > right.y
      assert.equal(overlapsWithClearance, false,
        `${left.key} ${JSON.stringify(left)} must clear ${right.key} ${JSON.stringify(right)}`)
    }
  }
})

test('thing spots stay fixed while residents leave and arrive', () => {
  const room = Object.freeze({ x: 12, y: 20, width: 220, height: 180 })
  const opening = stageFindFreeSpots(Object.freeze([
    Object.freeze({ key: 'resident:2', kind: 'resident' as const }),
    Object.freeze({ key: 'thing:7', kind: 'thing' as const }),
    Object.freeze({ key: 'resident:19', kind: 'resident' as const }),
  ]), room)
  const changed = stageFindFreeSpots(Object.freeze([
    Object.freeze({ key: 'thing:7', kind: 'thing' as const }),
    Object.freeze({ key: 'resident:31', kind: 'resident' as const }),
  ]), room, opening)

  assert.deepEqual(changed['thing:7'], opening['thing:7'])
  assert.ok(changed['resident:31'])
  assert.equal(changed['resident:2'], undefined)
  assert.equal(changed['resident:19'], undefined)

  const extension = Object.freeze({ x: 12, y: 240, width: 220, height: 180 })
  const extendedThing = Object.freeze({
    key: 'thing:7', kind: 'thing' as const, x: 40, y: 268, width: 32, height: 32,
  })
  const extended = stageFindFreeSpots(Object.freeze([
    Object.freeze({ key: 'thing:7', kind: 'thing' as const }),
    Object.freeze({ key: 'resident:31', kind: 'resident' as const }),
  ]), room, Object.freeze({ 'thing:7': extendedThing }), Object.freeze([extension]))
  assert.deepEqual(extended['thing:7'], extendedThing,
    'a thing on prior extension ground must not move when the room grows')
})

test('a genuinely full room grows enough for every free standing spot', () => {
  const entries = Object.freeze(Array.from({ length: 167 }, (_, index) => Object.freeze({
    key: `resident:${String(index + 1)}`,
    kind: 'resident' as const,
  })))
  const width = 440
  const height = stageStandingRoomHeight(width, entries.length, 280)
  const movedResident = Object.freeze({
    key: 'resident:1', kind: 'resident' as const, x: 50, y: 52, width: 32, height: 32,
  })
  const spots = stageFindFreeSpots(
    entries,
    Object.freeze({ x: 0, y: 0, width, height }),
    Object.freeze({ 'resident:1': movedResident }),
  )
  const ordinaryEntries = Object.freeze(entries.slice(0, 25))
  const ordinaryRoom = Object.freeze({ x: 0, y: 0, width, height: 280 })
  const ordinarySpots = stageFindFreeSpots(ordinaryEntries, ordinaryRoom)
  const crowdedEntries = Object.freeze(entries.slice(0, 30))
  const crowdedBase = stageFindFreeSpots(crowdedEntries, ordinaryRoom)
  const missingCount = crowdedEntries.length - Object.keys(crowdedBase).length
  const extensionHeight = stageStandingRoomHeight(width, missingCount, 64) + 64
  const grownSpots = stageFindFreeSpots(crowdedEntries, ordinaryRoom, Object.freeze({}),
    Object.freeze([{ x: 0, y: 360, width, height: extensionHeight }]))

  assert.equal(stageStandingRoomHeight(width, 15, 280), 280,
    'eight residents and seven things must fit the ordinary room')
  assert.equal(Object.keys(ordinarySpots).length, ordinaryEntries.length,
    'a room with actual free coordinates must not grow from a conservative count estimate')
  assert.ok(missingCount > 0, 'the crowded room must exhaust its actual free coordinates')
  assert.equal(Object.keys(grownSpots).length, crowdedEntries.length,
    'the missing occupants must fit the appended ground')
  assert.ok(height > 280, `full room height stayed ${String(height)}`)
  assert.equal(Object.keys(spots).length, entries.length)
  assert.deepEqual(spots['resident:1'], movedResident)
  assert.ok(Object.values(spots).every(spot =>
    spot.x >= 0 && spot.y >= 0 &&
    spot.x + spot.width <= width && spot.y + spot.height <= height))
})

test('corridor shortest paths use door and corner nodes and avoid a third room', () => {
  const layout = stageRoomLayout(Object.freeze([
    Object.freeze({ id: 1, parent_id: null, name: 'parent' }),
    Object.freeze({ id: 2, parent_id: 1, name: 'north' }),
    Object.freeze({ id: 3, parent_id: 1, name: 'middle' }),
    Object.freeze({ id: 4, parent_id: 1, name: 'founded south' }),
  ]), 1)
  const graph = stageBuildCorridorGraph(Object.values(layout.rooms))
  const route = stageShortestPath(graph, '2', '4')

  assert.equal(graph.roomDoors['4'], 'door:4', 'the founded room door must join the graph')
  assert.equal(route[0]?.id, 'door:2', `route start was ${JSON.stringify(route[0])}`)
  assert.equal(route.at(-1)?.id, 'door:4', `route end was ${JSON.stringify(route.at(-1))}`)
  assert.ok(route.every(node => node.kind === 'door' || node.kind === 'corner'),
    `route used only corridor nodes: ${JSON.stringify(route)}`)
  const middle = layout.rooms['3']!
  for (const [index, from] of route.entries()) {
    const to = route[index + 1]
    if (!to) continue
    const verticalCrossing = from.x > middle.x && from.x < middle.x + middle.width &&
      to.x > middle.x && to.x < middle.x + middle.width &&
      Math.min(from.y, to.y) < middle.y + middle.height &&
      Math.max(from.y, to.y) > middle.y
    const horizontalCrossing = from.y > middle.y && from.y < middle.y + middle.height &&
      to.y > middle.y && to.y < middle.y + middle.height &&
      Math.min(from.x, to.x) < middle.x + middle.width &&
      Math.max(from.x, to.x) > middle.x
    assert.equal(verticalCrossing || horizontalCrossing, false,
      `${from.id} ${JSON.stringify(from)} -> ${to.id} ${JSON.stringify(to)} crossed room 3 ${JSON.stringify(middle)}`)
  }
})

// One salvaged case, 'expanded-room replay endpoints attach to the ordered corridor rail', depended on the
// old DOM client (PART_24) and was left out; the corridor math it covered is exercised by the cases above.

test('quiet room ground exposes identity and exact counts but no occupied spots', () => {
  const box = Object.freeze({
    id: '7', parentId: '1', x: 20, y: 30, width: 220, height: 180,
    door: Object.freeze({ x: 20, y: 120, side: 'left' as const }),
  })
  const quiet = stageQuietRoom(Object.freeze({
    id: 7, name: 'the library', owner: 'mira', quiet: true,
    counts: Object.freeze({ residents: 12, things: 8 }),
  }), box)

  assert.deepEqual(quiet, Object.freeze({
    box,
    name: 'the library',
    owner: 'mira',
    counts: Object.freeze({ residents: 12, things: 8 }),
    spots: Object.freeze([]),
  }))
})
