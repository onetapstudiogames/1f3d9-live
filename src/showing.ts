import type { ReplayPlace } from './city/types.ts'
import type { SpeechBubble } from './speech.ts'

export type ShowingMoment = Readonly<{ ballot: boolean; confetti: boolean; startedAt: number; expiresAt: number }>
export type ShowingFrame = Readonly<{ alpha: number; ballotY: number | null; confetti: number }>
export type PixelRect = Readonly<{ x: number; y: number; width: number; height: number; color: number; alpha: number }>

const ROOM_ID = 438
const ROOM_NAME = 'the showing room'
const COUNT_LINE = 'THE FIRST COUNT. Question one is closed.'

export function showingFor(bubble: SpeechBubble | null, visible: boolean, places: readonly ReplayPlace[], actor = ''): ShowingMoment | null {
  if (!bubble || !visible || !Number.isFinite(bubble.startedAt) || !Number.isFinite(bubble.expiresAt)
    || bubble.expiresAt <= bubble.startedAt) return null
  const room = places.find(place => place.id === bubble.placeId)
  if (!room || room.id !== ROOM_ID || room.name !== ROOM_NAME || room.quiet) return null
  const ballot = /^\s*VOTE(?:\s|$)/.test(bubble.text)
  const confetti = bubble.noteId === 10059 && actor.trim() === 'founder' && bubble.text === COUNT_LINE
  return Object.freeze({ ballot, confetti, startedAt: bubble.startedAt, expiresAt: bubble.expiresAt })
}

export function showingFrame(moment: ShowingMoment, now: number): ShowingFrame | null {
  if (!Number.isFinite(now) || now < moment.startedAt || now >= moment.expiresAt) return null
  const span = Math.max(1, moment.expiresAt - moment.startedAt); const progress = (now - moment.startedAt) / span
  const alpha = Math.min(1, progress * 5, (1 - progress) * 5)
  return Object.freeze({ alpha, ballotY: moment.ballot ? Math.round(-20 + Math.min(1, progress * 2) * 32) : null,
    confetti: moment.confetti ? Math.min(1, progress * 4) : 0 })
}

export function spotlightCells(): readonly PixelRect[] {
  return freeze([{ x: -18, y: -28, width: 36, height: 4, color: 0xfff1a8, alpha: .18 },
    { x: -22, y: -24, width: 44, height: 24, color: 0xffe47a, alpha: .14 },
    { x: -27, y: 0, width: 54, height: 5, color: 0xffd65c, alpha: .22 }])
}

export function ballotCells(): readonly PixelRect[] {
  return freeze([{ x: 12, y: 0, width: 10, height: 7, color: 0xf7eed2, alpha: 1 },
    { x: 12, y: 0, width: 10, height: 2, color: 0x594a3b, alpha: 1 },
    { x: 8, y: 8, width: 18, height: 13, color: 0x80664d, alpha: 1 },
    { x: 11, y: 11, width: 12, height: 2, color: 0x352d27, alpha: 1 }])
}

export function confettiCells(): readonly PixelRect[] {
  return freeze([{ x: -24, y: -22, width: 3, height: 5, color: 0xe95c59, alpha: 1 },
    { x: -12, y: -31, width: 4, height: 3, color: 0x4a87d9, alpha: 1 },
    { x: 8, y: -29, width: 3, height: 5, color: 0xf1c84c, alpha: 1 },
    { x: 21, y: -18, width: 5, height: 3, color: 0x5caf75, alpha: 1 }])
}

function freeze(cells: PixelRect[]): readonly PixelRect[] { return Object.freeze(cells.map(cell => Object.freeze(cell))) }
