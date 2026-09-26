import type { RoomLine } from './city/changes.ts'
import type { ReplayEvent } from './city/types.ts'

/** The fixed answers a ping takes (city decision 120), in the room log's words. */
export const TALK_ANSWER_WORDS = Object.freeze({ yes: 'yes', no: 'no', in_a_moment: 'in a moment' } as const)
export const LINE_READ_ISSUE = 'Some lines could not be read; they are left out of the picture.'

export function lineLogText(actor: string, line: string): string {
  return `${actor}: ${line}`
}

export function pingLogText(actor: string, target: string): string {
  return `${actor} pinged ${target}.`
}

export function answerLogText(actor: string, sender: string, answer: unknown): string | null {
  const words = typeof answer === 'string' && Object.hasOwn(TALK_ANSWER_WORDS, answer)
    ? TALK_ANSWER_WORDS[answer as keyof typeof TALK_ANSWER_WORDS]
    : null
  return words ? `${actor} answered ${sender}'s ping: ${words}.` : null
}

/**
 * A line from the room's shared lines read, as the row the room log and the speech cards
 * take. That read names no change id, so change_id carries the line marker the read was
 * keyed on: it only breaks ties, because the log orders by time, and the log keys the entry
 * by the line's own id.
 */
export function lineEvent(line: RoomLine, lineMarker: string): ReplayEvent {
  return Object.freeze({
    actor: line.author, at: line.createdAt, change_id: lineMarker, event_id: line.id, kind: 'line_said',
    detail: Object.freeze({ line_id: line.id, place_id: line.placeId }), line: line.body, line_cut: false,
  })
}
