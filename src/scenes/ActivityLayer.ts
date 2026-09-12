import type Phaser from 'phaser'
import type { CueFrame } from '../activity-cues.ts'
import type { NestedLayout } from '../ground/nested.ts'
import { activityCueRects } from '../resident-overlays.ts'

export type ActivityPosition = Readonly<{ id: number; placeId: number | null; x: number; y: number; visible: boolean }>
type PaintPosition = Readonly<{ x: number; y: number; roomId: number | null; kind: 'resident' | 'thing' | 'room' }>

export class ActivityLayer {
  private readonly graphics: Phaser.GameObjects.Graphics
  constructor(scene: Phaser.Scene) { this.graphics = scene.add.graphics().setDepth(206) }

  update(frames: readonly CueFrame[], residents: readonly ActivityPosition[], things: readonly ActivityPosition[],
    layout: NestedLayout, hidden: ReadonlySet<number>, zoom: number): void {
    this.graphics.clear()
    for (const frame of frames) {
      const position: PaintPosition | null = frame.anchor
        ? { ...frame.anchor, kind: frame.thingId !== null ? 'thing' : frame.residentId !== null ? 'resident' : 'room' }
        : this.entityAnchor(frame, residents, things) ?? this.roomAnchor(frame.roomId, layout, zoom)
      if (!position || position.roomId === null || hidden.has(position.roomId)) continue
      const color = frame.cue === 'looking' ? 0xffe69a : 0xe7c965
      const rects = activityCueRects(frame.cells, position.kind, zoom, color, frame.alpha)
      this.graphics.fillStyle(0x243c30, frame.alpha)
      for (const cell of rects) this.graphics.fillRect(position.x + cell.x - 1, position.y + cell.y - 1,
        cell.width + 2, cell.height + 2)
      this.graphics.fillStyle(color, frame.alpha)
      for (const cell of rects) this.graphics.fillRect(
        position.x + cell.x, position.y + cell.y, cell.width, cell.height)
    }
  }

  destroy(): void { this.graphics.destroy() }

  private entityAnchor(frame: CueFrame, residents: readonly ActivityPosition[], things: readonly ActivityPosition[]): PaintPosition | null {
    const thing = frame.thingId === null ? undefined : things.find(row => row.id === frame.thingId && row.visible && row.placeId === frame.roomId)
    const resident = frame.residentId === null ? undefined : residents.find(row => row.id === frame.residentId && row.visible && row.placeId === frame.roomId)
    const found = thing ?? resident
    return found ? { x: found.x, y: found.y, roomId: found.placeId, kind: thing ? 'thing' : 'resident' } : null
  }

  private roomAnchor(roomId: number | null, layout: NestedLayout, zoom: number): PaintPosition | null {
    const room = roomId === null ? undefined : layout.rooms[roomId]
    const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
    return room ? { roomId: room.id, x: room.x + room.width - 24 / safeZoom,
      y: room.y + 20 / safeZoom, kind: 'room' } : null
  }
}
