import test from 'node:test'
import assert from 'node:assert/strict'
import { nearbyRooms, roomsInCamera } from '../src/camera.ts'
import { nestedLayout } from '../src/ground/nested.ts'

test('nearby views prefer an occupied nested room over an empty world floor', () => {
  const layout = nestedLayout([
    { id: 1, parent_id: null, name: 'world' }, { id: 2, parent_id: 1, name: 'town' },
    { id: 3, parent_id: 2, name: 'home' }, { id: 4, parent_id: 2, name: 'workshop' },
  ])
  const views = nearbyRooms(layout, [{ placeId: 3, visible: true }, { placeId: 4, visible: true }])
  assert.equal(views[0]?.id, 2)
  assert.deepEqual(nearbyRooms(layout, [{ placeId: 3, visible: false }]), [])
  assert.equal(new Set(views.map(view => view.id)).size, views.length)
})

test('a busy huge parent does not make the opening view unreadably small', () => {
  const layout = nestedLayout([
    { id: 1, parent_id: null }, { id: 2, parent_id: 1 }, { id: 3, parent_id: 2 },
    ...Array.from({ length: 225 }, (_, index) => ({ id: index + 4, parent_id: 1 })),
  ])
  const views = nearbyRooms(layout, [
    ...Array.from({ length: 100 }, () => ({ placeId: 1, visible: true })),
    { placeId: 3, visible: true },
  ])
  assert.equal(views[0]?.id, 2)
})

test('outline reads select only small nonquiet rooms in a genuinely near camera', () => {
  const layout = nestedLayout([
    { id: 1, parent_id: null, quiet: false }, { id: 2, parent_id: 1, quiet: true }, { id: 3, parent_id: 1, quiet: false },
  ])
  const room = layout.rooms[3]!
  const near = roomsInCamera(layout, { x: room.x, y: room.y, width: room.width, height: room.height }, 0.6)
  assert.ok(near.some(item => item.id === 3))
  assert.ok(near.every(item => !item.quiet))
  assert.deepEqual(roomsInCamera(layout, { x: 0, y: 0, width: 5000, height: 4000 }, 0.2), [])
  const large = { ...layout, rooms: { ...layout.rooms, 3: { ...room, width: 5000, standing: { ...room.standing, width: 4800 } } } }
  assert.equal(roomsInCamera(large, { x: room.standing.x, y: room.standing.y, width: 500, height: 400 }, 0.6)[0]?.id, 3)
})
