import type { Drawing, OutlineThing, ReplayEvent, Resident, Thing } from '../city/types.ts'
import type { NestedLayout } from '../ground/nested.ts'
import { liveNoteReferences } from '../live.ts'
import { NOTE_READ_ISSUE, verifiedNoteEvent } from '../note-words.ts'
import type { Simulation } from '../replay/simulation.ts'
import type { ThingState } from '../things.ts'

type DrawingReader = (id: number) => Promise<Drawing | null>
type Issue = (message: string) => void

async function inFours(ids: readonly number[], read: (id: number) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < ids.length; offset += 4) await Promise.all(ids.slice(offset, offset + 4).map(read))
}

export async function readResidentDrawings(census: readonly Resident[], residents: Simulation['residents'], read: DrawingReader,
  apply: (id: number, drawing: Drawing | null) => void, issue: Issue): Promise<void> {
  const ids = [...new Set([...census.filter(row => row.has_drawing).map(row => row.id),
    ...Object.values(residents).filter(row => !census.some(item => item.id === row.id)).map(row => row.id)])]
  await inFours(ids, async id => {
    try { apply(id, await read(id)) }
    catch (error) { console.error(error); issue('Some drawings could not be read; their last figures are kept.') }
  })
}

export async function readNoteWords(events: readonly ReplayEvent[], layout: NestedLayout,
  read: (id: number) => Promise<Readonly<{ author: string; placeId: number; text: string; cut: boolean }> | null>, issue: Issue): Promise<readonly ReplayEvent[]> {
  const result = [...events]
  const candidates = liveNoteReferences(events, layout)
  await inFours(candidates.map((_, index) => index), async candidateIndex => {
    const { event, index } = candidates[candidateIndex]!
    try {
      const note = verifiedNoteEvent(event, await read(event.detail.note_id as number))
      if (note) result[index] = note
      else issue(NOTE_READ_ISSUE)
    } catch (error) { console.error(error); issue(NOTE_READ_ISSUE) }
  })
  return Object.freeze(result)
}

export type ThingDetailReads = Readonly<{
  shown: () => readonly ThingState[]
  namesRead: Set<number>; drawingsRead: Set<number>; drawingHints: Map<number, boolean | undefined>
  readThing: (id: number) => Promise<Thing | null>; readDrawing: DrawingReader
  applyName: (id: number, name: string) => void; applyDrawing: (id: number, drawing: Drawing) => void; issue: Issue
}>

export function thingDetailsPending(thing: ThingState, reads: Pick<ThingDetailReads, 'namesRead' | 'drawingsRead' | 'drawingHints'>): boolean {
  return !reads.namesRead.has(thing.id) || (reads.drawingHints.get(thing.id) !== false && !reads.drawingsRead.has(thing.id))
}

export function rememberOutlineThingDetails(thing: OutlineThing, reads: Pick<ThingDetailReads, 'namesRead' | 'drawingHints' | 'applyName'>): void {
  reads.namesRead.add(thing.id)
  reads.applyName(thing.id, thing.name)
  if (thing.hasDrawing !== undefined) reads.drawingHints.set(thing.id, thing.hasDrawing)
}

export async function readVisibleThingDetails(reads: ThingDetailReads): Promise<void> {
  for (;;) {
    const batch = reads.shown().filter(thing => thingDetailsPending(thing, reads)).slice(0, 4)
    if (!batch.length) return
    await Promise.all(batch.map(async thing => {
      if (!reads.namesRead.has(thing.id)) {
        reads.namesRead.add(thing.id)
        try {
          const detail = await reads.readThing(thing.id)
          if (detail) { reads.applyName(thing.id, detail.name); reads.drawingHints.set(thing.id, detail.has_drawing) }
          else if (thing.name === null) reads.issue('Some thing names are missing; those name plates stay blank.')
        } catch (error) { console.error(error); if (thing.name === null) reads.issue('Some thing names could not be read; those name plates stay blank.') }
      }
      // A name read or earlier batch can finish after the viewer has left this room.
      if (reads.drawingHints.get(thing.id) === false || reads.drawingsRead.has(thing.id)
        || !reads.shown().some(row => row.id === thing.id)) return
      reads.drawingsRead.add(thing.id)
      try { const drawing = await reads.readDrawing(thing.id); if (drawing) reads.applyDrawing(thing.id, drawing) }
      catch (error) { console.error(error); reads.issue('Some thing drawings could not be read; their pixel icons are kept.') }
    }))
  }
}
