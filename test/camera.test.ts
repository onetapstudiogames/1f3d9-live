import test from 'node:test'
import assert from 'node:assert/strict'
import { nearbyRooms } from '../src/camera.ts'
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
