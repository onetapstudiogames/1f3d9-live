import type { RoomLine, RoomLinesPage } from './city/changes.ts'
import type { TalkNow } from './city/talk-now.ts'
import type { ReplayEvent } from './city/types.ts'

/** The live page's talk check (city decision 130). The city serves the interval as
 * check_interval_ms; these are the page's own floor, ceiling, and fallback. */
export const TALK_CHECK_MS = 2_000
export const TALK_CHECK_MAX_MS = 600_000
export const TALK_RETRY_MAX_MS = 30_000
/** A listening mark needs a check this recent. */
export const TALK_HEAD_STALE_MS = 10_000
export const TALK_IDLE_MS = 30 * 60_000
export const TALK_IDLE_CHECK_MS = 30_000

export type LineAnchor = Readonly<{ placeId: number; at: string; refresh: number }>

/** The served interval, never faster than 2 seconds; anything but a whole number reads as 2 seconds. */
export function talkCheckMs(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(TALK_CHECK_MAX_MS, Math.max(TALK_CHECK_MS, value))
    : TALK_CHECK_MS
}

export function talkCheckDelay(failures: number, checkMs: number = TALK_CHECK_MS, idleMs = 0): number {
  if (failures === 0 && idleMs >= TALK_IDLE_MS) return Math.max(TALK_IDLE_CHECK_MS, checkMs)
  return failures > 0 ? Math.min(Math.max(TALK_RETRY_MAX_MS, checkMs), checkMs * 2 ** failures) : checkMs
}

/** The room's lines are read again only when the city's line marker is above the page's. */
export function talkNeedsRead(marker: string | null, lineMarker: string): boolean {
  return marker === null || BigInt(lineMarker) > BigInt(marker)
}

/** The room lines the page has not shown, in id order, and every id on the page. */
export function newRoomLines(page: RoomLinesPage, seen: ReadonlySet<number>):
  Readonly<{ fresh: readonly RoomLine[]; seen: ReadonlySet<number> }> {
  const fresh = page.lines.filter(line => !seen.has(line.id)).sort((left, right) => left.id - right.id)
  return Object.freeze({
    fresh: Object.freeze(fresh),
    seen: new Set([...seen, ...page.lines.map(line => line.id), ...page.removedIds]),
  })
}

export function listeningIds(head: TalkNow | null, roomId: number | null, headAtMs: number,
  nowMs: number): ReadonlySet<number> {
  if (!head || roomId === null || !Number.isFinite(headAtMs) || nowMs - headAtMs > TALK_HEAD_STALE_MS) return new Set()
  return new Set(head.listening.filter(row => row.placeId === roomId).map(row => row.residentId))
}

/** The slower refresh leaves lines to the talk check, so a line is logged and carded once. */
export function withoutTalkLines(events: readonly ReplayEvent[]): readonly ReplayEvent[] {
  return Object.freeze(events.filter(event => event.kind !== 'line_said'))
}

/** A line already placed its speaker in its room, so the slower refresh skips that older move. */
export function withoutMovesBehindLines(events: readonly ReplayEvent[],
  anchors: ReadonlyMap<string, LineAnchor>): readonly ReplayEvent[] {
  return Object.freeze(events.filter(event => {
    const anchor = event.actor ? anchors.get(event.actor.trim()) : undefined
    return !(anchor && event.kind === 'action' && event.detail.status === 'applied'
      && ['move', 'go_home'].includes(String(event.detail.action))
      && event.detail.to_place_id === anchor.placeId && Date.parse(event.at) <= Date.parse(anchor.at))
  }))
}

/** Once a slower refresh begun after an anchor has finished, the anchor is done. */
export function anchorsAfter(anchors: ReadonlyMap<string, LineAnchor>, refresh: number): ReadonlyMap<string, LineAnchor> {
  return new Map([...anchors].filter(([, anchor]) => anchor.refresh >= refresh))
}
