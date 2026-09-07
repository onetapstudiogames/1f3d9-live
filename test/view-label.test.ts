import assert from 'node:assert/strict'
import test from 'node:test'
import { cameraViewLabel } from '../src/view-label.ts'
import { planPlaces } from '../src/places.ts'
import type { ReplayFile } from '../src/city/types.ts'

const place = { id: 1, name: 'new room', parent_id: null, owner: null, owner_id: null, quiet: false, has_drawing: false }
const record: ReplayFile = {
  span: '1h', window_start: '2026-09-07T10:00:00Z', window_end: '2026-09-07T11:00:00Z',
  checkpoint: '2', complete: true, row_ceiling: 800, map: { places: [place] }, start: {}, counts: {},
  timeline: [{ at: '2026-09-07T10:20:00Z', change_id: '2', event_id: 2, actor: 'mara', kind: 'place_renamed',
    detail: { place_id: 1, name: 'new room', former_name: 'old room' } }],
}
const view = { director: true, directorStatus: '', followed: undefined, place, plan: planPlaces(record),
  time: Date.parse('2026-09-07T10:10:00Z'), overview: 'The whole city' }

test('Director names follow the recorded clock while the same room remains selected', () => {
  assert.equal(cameraViewLabel(view), 'Director: watching old room')
  assert.equal(cameraViewLabel({ ...view, time: Date.parse('2026-09-07T10:20:00Z') }), 'Director: watching new room')
  assert.equal(cameraViewLabel({ ...view, time: NaN }), 'Director: watching a room whose recorded name is unknown')
})

test('waiting and manual views do not keep an old Director label', () => {
  assert.equal(cameraViewLabel({ ...view, directorStatus: 'Director is waiting.' }), 'Director is waiting.')
  assert.equal(cameraViewLabel({ ...view, director: false }), 'old room')
  assert.equal(cameraViewLabel({ ...view, director: false, followed: 'mara' }), 'Following mara')
  assert.equal(cameraViewLabel({ ...view, director: false, followed: null }), 'Following a figure the resident list does not name')
  assert.equal(cameraViewLabel({ ...view, director: false, time: NaN }), 'This room’s earlier name is not recorded.')
  assert.equal(cameraViewLabel({ ...view, director: false, place: undefined }), 'The whole city')
  assert.equal(cameraViewLabel({ ...view, director: false, plan: undefined }), 'The whole city')
  assert.equal(cameraViewLabel({ ...view, director: false, time: undefined }), 'The whole city')
})
