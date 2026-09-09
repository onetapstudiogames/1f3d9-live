import type { ReplayEvent } from './city/types.ts'

type QueuedLike = Readonly<{ event?: ReplayEvent }>
export type RoomSpeechResident = Readonly<{
  id?: number
  queue?: readonly QueuedLike[]
  bubble?: Readonly<{ placeId?: number | null; expiresAt?: number }> | null
  placeId?: number | null
  handle?: string
}>

/**
 * Reports whether a queued note may claim its room's single speech card.
 * Pass the complete resident collection: notes are inspected throughout each
 * resident queue, including notes waiting behind that resident's other work.
 */
export function roomNoteMayStart(
  event: ReplayEvent,
  residents: Readonly<Record<string | number, RoomSpeechResident>> | readonly RoomSpeechResident[],
  now: number,
  sleepers: ReadonlySet<number> = new Set(),
): boolean {
  const roomId = noteRoom(event)
  if (roomId === null) return true
  const rows = Array.isArray(residents) ? residents : residents && typeof residents === 'object' ? Object.values(residents) : []
  const awakeRows = rows.filter(row => !finiteResidentId(row?.id) || !sleepers.has(row.id))
  if (awakeRows.some(row => row?.bubble && row.bubble.placeId === roomId
    && finiteNumber(row.bubble.expiresAt) && row.bubble.expiresAt > now)) return false

  const queuedNotes = awakeRows.flatMap((row, residentIndex) => {
    const queue: readonly QueuedLike[] = Array.isArray(row?.queue) ? row.queue : []
    return queue.flatMap((queued, queueIndex) => {
      const queuedEvent = queued?.event
      return queuedEvent && noteRoom(queuedEvent) === roomId
        ? [{ event: queuedEvent, residentIndex, queueIndex }] : []
    })
  })
  const candidate = queuedNotes.find(item => item.event === event)
  if (!candidate) return true
  const first = [...queuedNotes].sort(compareQueuedNotes)[0]
  return first?.event === event
}

function finiteResidentId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function noteRoom(event: ReplayEvent | undefined): number | null {
  const value = event?.kind === 'note' ? event.detail?.place_id : undefined
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function compareQueuedNotes(
  left: Readonly<{ event: ReplayEvent; residentIndex: number; queueIndex: number }>,
  right: Readonly<{ event: ReplayEvent; residentIndex: number; queueIndex: number }>,
): number {
  return compareChangeIds(left.event.change_id, right.event.change_id)
    || finiteEventId(left.event.event_id) - finiteEventId(right.event.event_id)
    || String(left.event.actor ?? '').localeCompare(String(right.event.actor ?? ''))
    || left.residentIndex - right.residentIndex || left.queueIndex - right.queueIndex
}

function compareChangeIds(left: string, right: string): number {
  if (/^\d+$/u.test(left) && /^\d+$/u.test(right)) {
    const normalizedLeft = left.replace(/^0+(?=\d)/u, '')
    const normalizedRight = right.replace(/^0+(?=\d)/u, '')
    return normalizedLeft.length - normalizedRight.length || normalizedLeft.localeCompare(normalizedRight)
  }
  return left.localeCompare(right)
}

function finiteEventId(value: number): number {
  return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER
}
