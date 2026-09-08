export const NAME_LABEL = Object.freeze({
  width: 124,
  height: 23,
  textWidth: 112,
  fontSize: 13,
  pauseMs: 1_200,
  speed: 18,
  gap: 28,
})

export type LabelContent = Readonly<{ showKind: boolean; scroll: boolean }>

export function labelContent(name: string, kind: string | null, nameWidth: number, kindWidth: number): LabelContent {
  const scroll = nameWidth > NAME_LABEL.textWidth
  const showKind = !scroll && name.length > 0 && kind !== null && kind.length > 0
    && nameWidth + kindWidth + 5 <= NAME_LABEL.textWidth
  return Object.freeze({ showKind, scroll })
}

export function marqueeOffset(textWidth: number, elapsedMs: number): number {
  if (textWidth <= NAME_LABEL.textWidth) return 0
  const distance = textWidth + NAME_LABEL.gap
  const travelMs = distance / NAME_LABEL.speed * 1_000
  const cycleMs = NAME_LABEL.pauseMs + travelMs
  const withinCycle = Math.max(0, elapsedMs) % cycleMs
  if (withinCycle < NAME_LABEL.pauseMs) return 0
  return -Math.min(distance, (withinCycle - NAME_LABEL.pauseMs) / 1_000 * NAME_LABEL.speed)
}
