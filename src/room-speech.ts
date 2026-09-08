import type { SpeechBubble } from './speech.ts'
import type { NestedLayout } from './ground/nested.ts'
import { roomIsPublic } from './room-view.ts'

export type RoomSpeechResident = Readonly<{
  id: number
  handle: string
  placeId: number | null
  bubble: SpeechBubble | null
}>

type DisplayedResident = Readonly<{ visible: boolean }>

function speechOrder(left: RoomSpeechResident, right: RoomSpeechResident): number {
  const leftBubble = left.bubble!
  const rightBubble = right.bubble!
  return leftBubble.startedAt - rightBubble.startedAt
    || (leftBubble.noteId ?? 0) - (rightBubble.noteId ?? 0)
    || left.id - right.id
}

export function hiddenRoomSpeech(
  residents: Readonly<Record<number, RoomSpeechResident>>,
  displayed: Readonly<Record<number, DisplayedResident>>,
  layout: NestedLayout | undefined,
  selectedRoomId: number | null,
  hiddenRooms: ReadonlySet<number>,
  now: number,
  sleepers: ReadonlySet<number> = new Set(),
): string | null {
  if (selectedRoomId === null || !layout || !roomIsPublic(layout, selectedRoomId)
    || hiddenRooms.has(selectedRoomId) || !Number.isFinite(now)) return null
  const candidates = Object.values(residents).filter(resident => {
    const bubble = resident.bubble
    return !sleepers.has(resident.id) && resident.placeId === selectedRoomId && bubble?.placeId === selectedRoomId
      && displayed[resident.id]?.visible !== true && resident.handle.trim().length > 0
      && bubble !== null && bubble.text.trim().length > 0 && bubble.startedAt <= now && now < bubble.expiresAt
  }).sort(speechOrder)
  const resident = candidates.at(-1)
  return resident?.bubble ? `${resident.handle.trim()}: ${resident.bubble.text}` : null
}
