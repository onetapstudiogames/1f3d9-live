import type Phaser from 'phaser'
import type { CueFrame } from '../activity-cues.ts'
import type { NestedLayout } from '../ground/nested.ts'
import { residentActivityRects } from '../resident-overlays.ts'

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
        : this.entityAnchor(frame, residents, things) ?? this.roomAnchor(frame.roomId, layout)
      if (!position || position.roomId === null || hidden.has(position.roomId)) continue
      const color = frame.cue === 'looking' ? 0xffe69a : 0xe7c965
      this.graphics.fillStyle(color, frame.alpha)
      if (position.kind === 'resident') {
        for (const cell of residentActivityRects(frame.cells, color, frame.alpha)) this.graphics.fillRect(
          position.x + cell.x, position.y + cell.y, cell.width, cell.height)
      } else {
        const scale = Math.max(2, Math.round(2 / Math.max(0.5, zoom)))
        for (const [x, y] of frame.cells) this.graphics.fillRect(Math.round(position.x + 18 + x * scale), Math.round(position.y - 22 + y * scale), scale, scale)
      }
    }
  }

  destroy(): void { this.graphics.destroy() }

  private entityAnchor(frame: CueFrame, residents: readonly ActivityPosition[], things: readonly ActivityPosition[]): PaintPosition | null {
    const thing = frame.thingId === null ? undefined : things.find(row => row.id === frame.thingId && row.visible && row.placeId === frame.roomId)
    const resident = frame.residentId === null ? undefined : residents.find(row => row.id === frame.residentId && row.visible && row.placeId === frame.roomId)
    const found = thing ?? resident
    return found ? { x: found.x, y: found.y, roomId: found.placeId, kind: thing ? 'thing' : 'resident' } : null
  }

  private roomAnchor(roomId: number | null, layout: NestedLayout): PaintPosition | null {
    const room = roomId === null ? undefined : layout.rooms[roomId]
    return room ? { roomId: room.id, x: room.x + room.width - 42, y: room.y + 42, kind: 'room' } : null
  }
}
