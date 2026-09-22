import type { ReplayEvent } from './city/types.ts'

export function noteWords(body: string, cut: boolean): string {
  return cut ? `${body} (rest not read)` : body
}

/**
 * A walk-to-read note (city decision 102) keeps its body for a resident standing in its
 * place; a remote read gives only its first line. This fixed line follows that first line
 * on the speech card and in the room log, so nothing is invented for the missing body.
 */
export const WALK_TO_READ_LINE = '(rest read in person)'

export function walkToReadWords(firstLine: string): string {
  return firstLine.trim().length ? `${firstLine}\n${WALK_TO_READ_LINE}` : WALK_TO_READ_LINE
}

export type NoteBody = Readonly<{ author: string; placeId: number; text: string; cut: boolean; readInPerson?: true }>
export const NOTE_READ_ISSUE = 'Some note bodies could not be read; incomplete text is marked (rest not read).'

export function verifiedNoteEvent(event: ReplayEvent, note: NoteBody | null): ReplayEvent | null {
  if (!note || note.cut || note.author.trim() !== event.actor?.trim() || note.placeId !== event.detail.place_id) return null
  const line = note.readInPerson === true ? walkToReadWords(note.text) : note.text
  return Object.freeze({ ...event, line, line_cut: false })
}
