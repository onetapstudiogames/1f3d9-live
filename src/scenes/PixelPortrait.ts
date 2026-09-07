import type { Drawing, Thing } from '../city/types.ts'
import { drawingCells, type DrawingCell } from '../city/drawing.ts'
import type { ActivityEntity, ActivityEntityType } from '../activity.ts'

export type PortraitReaders = Readonly<{
  residentDrawing(id: number): Promise<Drawing | null>
  placeDrawing(id: number): Promise<Drawing | null>
  thing(id: number): Promise<Thing | null>
  thingDrawing(id: number): Promise<Drawing | null>
}>

const FALLBACKS: Readonly<Record<ActivityEntityType, readonly string[]>> = Object.freeze({
  resident: Object.freeze(['..00....', '.0110...', '..00....', '.0000...', '0.00.0..', '..00....', '.0..0...', '........']),
  place: Object.freeze(['........', '.000000.', '.011110.', '.010010.', '.010010.', '.011110.', '.000000.', '........']),
  thing: Object.freeze(['........', '..0000..', '.011110.', '.010010.', '.011110.', '..0000..', '........', '........']),
})

export function fallbackPortrait(type: ActivityEntityType): readonly DrawingCell[] {
  const colors = [0xe7c965, 0x65452f]
  return Object.freeze(FALLBACKS[type].flatMap((row, y) => [...row].flatMap((value, x) => value === '.'
    ? [] : [Object.freeze({ x, y, color: colors[Number(value)]! })])))
}

export class PixelPortrait {
  private readonly readers: PortraitReaders
  private readonly limit: number
  private readonly cache = new Map<string, Promise<readonly DrawingCell[]>>()
  private active = 0
  private readonly queue: (() => void)[] = []
  constructor(readers: PortraitReaders, limit = 4) { this.readers = readers; this.limit = Math.max(1, Math.floor(limit) || 1) }

  load(entity: ActivityEntity): Promise<readonly DrawingCell[]> {
    const key = `${entity.type}:${entity.id}`
    const cached = this.cache.get(key)
    if (cached) return cached
    const pending = this.slot(async () => {
      try {
        let drawing: Drawing | null = null
        if (entity.type === 'resident' && entity.hasDrawing) drawing = await this.readers.residentDrawing(entity.id)
        if (entity.type === 'place' && entity.hasDrawing) drawing = await this.readers.placeDrawing(entity.id)
        if (entity.type === 'thing') {
          const thing = await this.readers.thing(entity.id)
          if (thing?.has_drawing) drawing = await this.readers.thingDrawing(entity.id)
        }
        return drawing ? Object.freeze(drawingCells(drawing)) : fallbackPortrait(entity.type)
      } catch { return fallbackPortrait(entity.type) }
    })
    this.cache.set(key, pending)
    return pending
  }

  private async slot<T>(read: () => Promise<T>): Promise<T> {
    if (this.active >= Math.max(1, this.limit)) await new Promise<void>(resolve => this.queue.push(resolve))
    this.active += 1
    try { return await read() } finally {
      this.active -= 1; this.queue.shift()?.()
    }
  }
}
