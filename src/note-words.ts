import type { ReplayEvent } from './city/types.ts'

export function noteWords(body: string, cut: boolean): string {
  return cut ? `${body} (rest not read)` : body
}

type NoteBody = Readonly<{ author: string; placeId: number; text: string; cut: boolean }>
export const NOTE_READ_ISSUE = 'Some note bodies could not be read; incomplete text is marked (rest not read).'

export function verifiedNoteEvent(event: ReplayEvent, note: NoteBody | null): ReplayEvent | null {
  return note && !note.cut && note.author.trim() === event.actor?.trim() && note.placeId === event.detail.place_id
    ? Object.freeze({ ...event, line: note.text, line_cut: false }) : null
}
