import assert from 'node:assert/strict'
import test from 'node:test'
import type Phaser from 'phaser'
import type { CueFrame } from '../src/activity-cues.ts'
import type { NestedLayout } from '../src/ground/nested.ts'
import { ActivityLayer } from '../src/scenes/ActivityLayer.ts'

const layout: NestedLayout = { rootId: 3, width: 400, height: 400, rooms: {
  3: { id: 3, parentId: null, name: 'room', quiet: false, depth: 0, children: [],
    x: 0, y: 0, width: 400, height: 400, door: { x: 200, y: 400 },
    standing: { x: 24, y: 24, width: 352, height: 300 } },
} }
const resident = { id: 7, placeId: 3, x: 200, y: 300, visible: true }
const cue: CueFrame = { key: 'looking', cue: 'looking', roomId: 3, residentId: 7, thingId: null,
  anchor: null, cells: [[0, 0], [7, 4]], alpha: 1 }

function recordingLayer() {
  const rects: number[][] = []
  const colors: number[] = []
  const graphics = {
    setDepth: () => graphics, clear: () => { rects.length = 0; colors.length = 0 },
    fillStyle: (color: number) => { colors.push(color); return graphics },
    fillRect: (...rect: number[]) => { rects.push(rect); return graphics }, destroy: () => {},
  }
  return { layer: new ActivityLayer({ add: { graphics: () => graphics } } as unknown as Phaser.Scene), rects, colors }
}

test('the activity layer paints resident cues beside the enlarged head at a fixed screen scale', () => {
  const { layer, rects, colors } = recordingLayer()
  for (const zoom of [0.5, 1, 2]) {
    layer.update([cue], [resident], [], layout, new Set(), zoom)
    assert.deepEqual(rects.slice(-2), [[231.5, 261.5, 3.5, 3.5], [256, 275.5, 3.5, 3.5]])
    assert.deepEqual(rects.slice(0, 2), [[230.5, 260.5, 5.5, 5.5], [255, 274.5, 5.5, 5.5]])
    assert.deepEqual(colors, [0x243c30, 0xffe69a])
  }
  layer.update([{ ...cue, anchor: { x: 100, y: 200, roomId: 3 } }], [], [], layout, new Set(), 1)
  assert.deepEqual(rects.slice(-2), [[131.5, 161.5, 3.5, 3.5], [156, 175.5, 3.5, 3.5]])
})

test('thing and room cues retain their anchors and hidden rooms draw no cue', () => {
  const { layer, rects } = recordingLayer()
  layer.update([{ ...cue, thingId: 9 }], [resident], [{ ...resident, id: 9, x: 100, y: 100 }], layout, new Set(), 1)
  assert.deepEqual(rects.at(-2), [118, 78, 2, 2])
  layer.update([cue], [], [], layout, new Set(), 1)
  assert.deepEqual(rects.at(-2), [376, 20, 2, 2])
  layer.update([cue], [], [], layout, new Set(), 2)
  assert.deepEqual(rects.at(-2), [388, 10, 1, 1])
  layer.update([cue], [resident], [], layout, new Set([3]), 1)
  assert.deepEqual(rects, [])
})
