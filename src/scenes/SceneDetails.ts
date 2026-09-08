import type { Drawing, ReplayEvent, ReplayFile, Resident, Thing } from '../city/types.ts'
import type { NestedLayout } from '../ground/nested.ts'
import { liveNoteReferences } from '../live.ts'
import { planPlaces, type PlacePlan } from '../places.ts'
import { placesWithDrawings } from '../room-art.ts'
import type { Simulation } from '../replay/simulation.ts'
import type { ThingSimulation } from '../things.ts'

type DrawingReader = (id: number) => Promise<Drawing | null>
type Issue = (message: string) => void

async function inFours(ids: readonly number[], read: (id: number) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < ids.length; offset += 4) await Promise.all(ids.slice(offset, offset + 4).map(read))
}

export async function readPlacePlan(replay: ReplayFile, readHistory: (id: number) => Promise<readonly import('../places.ts').NameSpan[] | null>, issue: Issue): Promise<PlacePlan> {
  const initial = planPlaces(replay)
  const histories = new Map<number, readonly import('../places.ts').NameSpan[]>()
  await inFours(initial.historyPlaceIds, async id => {
    try { const history = await readHistory(id); if (history) histories.set(id, history) }
    catch (error) { console.error(error); issue('Some earlier place names could not be read; unknown names stay blank.') }
  })
  return planPlaces(replay, histories)
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

export async function readPlaceDrawings(replay: ReplayFile, layout: NestedLayout, read: DrawingReader,
  apply: (id: number, drawing: Drawing) => void, issue: Issue): Promise<void> {
  await inFours(placesWithDrawings(replay.map.places, layout), async id => {
    try { const drawing = await read(id); if (drawing) apply(id, drawing) }
    catch (error) { console.error(error); issue('Some place drawings could not be read; their rooms are kept.') }
  })
}

export async function readNoteWords(events: readonly ReplayEvent[], layout: NestedLayout,
  read: (id: number) => Promise<Readonly<{ author: string; placeId: number; text: string; cut: boolean }> | null>, issue: Issue): Promise<readonly ReplayEvent[]> {
  const result = [...events]
  const candidates = liveNoteReferences(events, layout)
  await inFours(candidates.map((_, index) => index), async candidateIndex => {
    const { event, index } = candidates[candidateIndex]!
    try {
      const note = await read(event.detail.note_id as number)
      if (!note || note.author.trim() !== event.actor?.trim() || note.placeId !== event.detail.place_id) {
        issue('Some live note words could not be verified, so their reference stays silent.'); return
      }
      result[index] = Object.freeze({ ...event, line: note.text, line_cut: note.cut })
    } catch (error) { console.error(error); issue('Some live note words could not be read, so their reference stays silent.') }
  })
  return Object.freeze(result)
}

export async function readInitialNoteWords(events: readonly ReplayEvent[], layout: NestedLayout,
  read: Parameters<typeof readNoteWords>[2], issue: Issue): Promise<readonly ReplayEvent[]> {
  const cut = events.filter(event => event.kind === 'note' && event.line_cut === true)
  const complete = await readNoteWords(cut, layout, read, issue)
  const byId = new Map(complete.map(event => [event.change_id, event]))
  return Object.freeze(events.map(event => byId.get(event.change_id) ?? event))
}

export async function readVisibleThingDetails(things: ThingSimulation['things'], hidden: ReadonlySet<number>, readIds: Set<number>,
  readThing: (id: number) => Promise<Thing | null>, readDrawing: DrawingReader,
  applyName: (id: number, name: string) => void, applyDrawing: (id: number, drawing: Drawing) => void, issue: Issue): Promise<void> {
  for (;;) {
    const batch = Object.values(things).filter(thing => thing.visible && !hidden.has(thing.placeId) && !readIds.has(thing.id)).slice(0, 4)
    if (!batch.length) return
    for (const thing of batch) readIds.add(thing.id)
    await Promise.all(batch.map(async thing => {
      let detail: Thing | null = null
      try { detail = await readThing(thing.id); if (detail) applyName(thing.id, detail.name); else if (thing.name === null) issue('Some thing names are missing; those name plates stay blank.') }
      catch (error) { console.error(error); if (thing.name === null) issue('Some thing names could not be read; those name plates stay blank.') }
      if (!detail?.has_drawing) return
      try { const drawing = await readDrawing(thing.id); if (drawing) applyDrawing(thing.id, drawing) }
      catch (error) { console.error(error); issue('Some thing drawings could not be read; their pixel icons are kept.') }
    }))
  }
}
