import type { ActivityEntry } from './activity.ts'

export const ACTION_CAPTION_LIFETIME = 3_000

export type ActionCaption = Readonly<{ key: string; residentId: number; thingId: number | null; move: boolean;
  text: string; startedAt: number; expiresAt: number }>
export type CaptionResident = Readonly<{ id: number; x: number; y: number; visible: boolean }>
export type CaptionRect = Readonly<{ x: number; y: number; width: number; height: number }>
export type SpeechRect = CaptionRect & Readonly<{ residentId: number }>
export type CaptionFrame = ActionCaption & CaptionRect

export function actionCaption(entry: ActivityEntry, startedAt: number): ActionCaption | null {
  if (!Number.isFinite(startedAt) || entry.actorResidentId == null || entry.kind === 'chat' || entry.cue === 'note') return null
  const actor = entry.entities.find(entity => entity.type === 'resident' && entity.id === entry.actorResidentId)?.name.trim()
  if (!actor || !entry.text.startsWith(`${actor} `)) return null
  let text = entry.text.slice(actor.length + 1).trim().replace(/\.$/, '')
  if (!text || /^talked(?:;|$)/.test(text)) return null
  return Object.freeze({ key: entry.key, residentId: entry.actorResidentId,
    thingId: entry.cue === 'move' ? null : entry.thingId ?? null, move: entry.cue === 'move', text,
    startedAt, expiresAt: startedAt + ACTION_CAPTION_LIFETIME })
}

export function actionCaptionLaneHeight(captions: readonly ActionCaption[], viewportHeight: number): number {
  if (!captions.length || !Number.isFinite(viewportHeight)) return 0
  const tallest = Math.max(...captions.map(caption => 12 + Math.max(1, Math.ceil(caption.text.length * 8 / 220)) * 18))
  return Math.min(Math.max(0, viewportHeight - 16), tallest) + 16
}

export function activeActionCaptions(captions: readonly ActionCaption[], now: number): readonly ActionCaption[] {
  return Object.freeze(captions.filter(caption => caption.expiresAt > now))
}

const overlaps = (a: CaptionRect, b: CaptionRect): boolean => a.x < b.x + b.width && a.x + a.width > b.x
  && a.y < b.y + b.height && a.y + a.height > b.y

export function layoutActionCaptions(captions: readonly ActionCaption[], residents: Readonly<Record<number, CaptionResident>>,
  viewport: Readonly<{ width: number; height: number }>, speech: readonly SpeechRect[] = []): readonly CaptionFrame[] {
  const frames: CaptionFrame[] = []
  const gutter = 8
  for (const caption of captions) {
    const resident = residents[caption.residentId]
    if (!resident?.visible || viewport.width <= gutter * 2 || viewport.height <= gutter * 2) continue
    const width = Math.min(240, Math.max(72, caption.text.length * 8 + 20), viewport.width - gutter * 2)
    const lines = Math.max(1, Math.ceil((caption.text.length * 8) / Math.max(1, width - 20)))
    const height = Math.min(viewport.height - gutter * 2, 12 + lines * 18)
    const centerX = Math.min(viewport.width - gutter - width, Math.max(gutter, resident.x - width / 2))
    // Every visible resident's name plate and every speech card is an obstacle, not only the actor's own.
    const names: CaptionRect[] = Object.values(residents).filter(row => row.visible)
      .map(row => ({ x: row.x - 64, y: row.y + 28, width: 128, height: 28 }))
    const obstacles: readonly CaptionRect[] = [...speech, ...names, ...frames]
    const xs = [...new Set([centerX, gutter, viewport.width - gutter - width])]
    const preferredY = [resident.y - 42 - height, resident.y + 62]
    const scanY = Array.from({ length: Math.max(1, Math.floor((viewport.height - gutter * 2 - height) / 4) + 1) },
      (_, index) => viewport.height - gutter - height - index * 4)
    const candidates = [...preferredY, ...scanY, gutter]
    const point = xs.flatMap(x => candidates.map(y => ({ x, y: Math.min(viewport.height - gutter - height, Math.max(gutter, y)) })))
      .find(point => !obstacles.some(rect => overlaps({ ...point, width, height }, rect)))
    if (!point) continue
    frames.push(Object.freeze({ ...caption, ...point, width, height }))
  }
  return Object.freeze(frames)
}
