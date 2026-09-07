import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ReplayFile, Resident } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { roomCapacity } from '../src/replay/simulation.ts'
import { seaViewport } from '../src/sea.ts'

const replay = JSON.parse(readFileSync(new URL('fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
const census = [1, 2].flatMap(page => (JSON.parse(readFileSync(new URL(
  `fixtures/residents-presence-page${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)
const layout = nestedLayout(replay.map.places, roomCapacity(replay, census))
const root = layout.rooms[layout.rootId]!
const close = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 0.000001,
  `${actual} should equal ${expected}`)

test('the real large map never becomes a map-sized sea canvas, at any supported camera scale', () => {
  assert.ok(root.width > 16000 && root.height > 16000)
  for (const [width, height] of [[1280, 800], [375, 812]]) for (const zoom of [0.005, 0.025, 0.2, 0.65, 1, 3]) {
    const camera = { width: width!, height: height!, zoom,
      scrollX: root.width / 2 - width! / 2, scrollY: root.height / 2 - height! / 2 }
    const frame = seaViewport(root, camera)!
    assert.ok(frame)
    assert.equal(frame.pixelWidth, width)
    assert.equal(frame.pixelHeight, height)
    const scaleX = frame.width / frame.pixelWidth
    const scaleY = frame.height / frame.pixelHeight
    assert.ok(frame.x + frame.cropX * scaleX >= root.x + 4 - 0.000001)
    assert.ok(frame.y + frame.cropY * scaleY >= root.y + 4 - 0.000001)
    assert.ok(frame.x + (frame.cropX + frame.cropWidth) * scaleX <= root.x + root.width - 4 + 0.000001)
    assert.ok(frame.y + (frame.cropY + frame.cropHeight) * scaleY <= root.y + root.height - 4 + 0.000001)
    const screenX = (frame.x - camera.scrollX - width! / 2) * zoom + width! / 2
    const screenY = (frame.y - camera.scrollY - height! / 2) * zoom + height! / 2
    assert.ok(screenX >= -0.000001 && screenY >= -0.000001)
    assert.ok(screenX + frame.width * zoom <= width! + 0.000001)
    assert.ok(screenY + frame.height * zoom <= height! + 0.000001)
    close(frame.tileScaleX * frame.width / frame.pixelWidth, 1)
    close(frame.tileScaleY * frame.height / frame.pixelHeight, 1)
  }
})

test('one thousand pans and zooms keep the same backing size while only the visible crop changes', () => {
  const sizes = new Set<string>()
  const crops = new Set<string>()
  for (let index = 0; index < 1000; index += 1) {
    const zoom = [0.005, 0.65, 3][index % 3]!
    const frame = seaViewport(root, { width: 375, height: 812, zoom,
      scrollX: (index % 101) / 100 * root.width - 375 / 2,
      scrollY: (index % 97) / 96 * root.height - 812 / 2 })!
    assert.ok(frame)
    sizes.add(`${frame.pixelWidth}:${frame.pixelHeight}`)
    crops.add(`${frame.cropX}:${frame.cropY}:${frame.cropWidth}:${frame.cropHeight}`)
  }
  assert.deepEqual([...sizes], ['375:812'])
  assert.ok(crops.size > 1)
})

test('panning and zooming leave the water pattern fixed to the same recorded map floor', () => {
  const modulo = (n: number): number => ((n % 128) + 128) % 128
  const point = { x: root.width / 2 + 17, y: root.height / 2 + 29 }
  for (const zoom of [0.2, 0.65, 3]) for (const pan of [0, 53, 137]) {
    const frame = seaViewport(root, { width: 1280, height: 800, zoom,
      scrollX: point.x - 640 + pan, scrollY: point.y - 400 + pan })!
    assert.ok(frame)
    close(modulo(point.x - frame.x + frame.tileX), modulo(point.x - root.x - 4))
    close(modulo(point.y - frame.y + frame.tileY), modulo(point.y - root.y - 4))
  }
})

test('a view outside the real world creates no sea surface', () => {
  assert.equal(seaViewport(root, { width: 375, height: 812, zoom: 1,
    scrollX: -1000, scrollY: -2000 }), null)
})
