import assert from 'node:assert/strict'
import test from 'node:test'

import { ROOM_RESIDENT_SIZE } from '../src/room-appearance.ts'
import { residentReservationFootprint } from '../src/resident-footprint.ts'

test('resident reservation footprints use the room art size while preserving the resident centre', () => {
  const footprint = residentReservationFootprint('resident:7', { x: 100, y: 80 })

  assert.deepEqual(footprint, {
    key: 'resident:7',
    kind: 'resident',
    x: 100 - ROOM_RESIDENT_SIZE / 2,
    y: 80 - ROOM_RESIDENT_SIZE / 2,
    width: ROOM_RESIDENT_SIZE,
    height: ROOM_RESIDENT_SIZE,
  })
})
