import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cameraFrame, zoomAt, followActivity, focusTarget, motionSpeed } from '../src/viewer.ts'

test('manual browsing resumes only on a new activity from the selected resident', () => {
  const waiting = { residentId: 2, suspended: true, activityId: '10' }
  assert.equal(followActivity(waiting, 3, '11'), waiting)
  assert.equal(followActivity(waiting, 2, '10'), waiting)
  assert.equal(followActivity(waiting, 2, null), waiting)
  assert.deepEqual(followActivity(waiting, 2, '12'), { residentId: 2, suspended: false, activityId: '12' })
})

test('pinch and wheel zoom preserve the world point beneath the gesture', () => {
  const camera = { scrollX: 500, scrollY: 300, width: 375, height: 812, zoom: 0.65 }
  const anchor = { x: 90, y: 240 }
  const before = cameraFrame(camera)
  const next = zoomAt(camera, 1.3, anchor)
  assert.equal(next.zoom, 1.3)
  assert.ok(Math.abs(next.x - 375 / 2 / next.zoom + anchor.x / next.zoom - (before.x + anchor.x / camera.zoom)) < 0.0001)
  assert.ok(Math.abs(next.y - 812 / 2 / next.zoom + anchor.y / next.zoom - (before.y + anchor.y / camera.zoom)) < 0.0001)
  assert.equal(zoomAt(camera, 99, anchor).zoom, 3)
  assert.equal(zoomAt(camera, Number.NaN, anchor).zoom, 0.65)
})

test('Focus chooses visible current conversations ahead of walking, with stable ties', () => {
  const moving = { key: 'walk', x: 1, y: 2, roomId: 3, rank: 1, startedAt: 10 }
  const talking = { ...moving, key: 'note', rank: 5, startedAt: 20 }
  assert.equal(focusTarget([moving, talking]), talking)
  assert.equal(focusTarget([]), null)
  assert.equal(focusTarget([{ ...moving, x: NaN }]), null)
})

test('normal clock speed keeps readable animation lengths instead of minute-long steps', () => {
  assert.equal(motionSpeed(1), 60)
  assert.equal(motionSpeed(60), 60)
  assert.equal(motionSpeed(120), 120)
})
