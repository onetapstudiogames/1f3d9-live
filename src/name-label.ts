export const NAME_LABEL = Object.freeze({
  width: 124,
  height: 23,
  textWidth: 112,
  fontSize: 13,
  pauseMs: 1_200,
  speed: 18,
  gap: 28,
  padding: 12,
})

export type LabelContent = Readonly<{
  showKind: boolean
  scroll: boolean
  width: number
  textWidth: number
}>

export function labelContent(name: string, kind: string | null, nameWidth: number, kindWidth: number): LabelContent {
  const scroll = nameWidth > NAME_LABEL.textWidth
  const showKind = !scroll && name.length > 0 && kind !== null && kind.length > 0
    && nameWidth + kindWidth + 5 <= NAME_LABEL.textWidth
  const contentWidth = scroll ? NAME_LABEL.textWidth : nameWidth + (showKind ? kindWidth + 5 : 0)
  const width = Math.min(NAME_LABEL.width, contentWidth + NAME_LABEL.padding)
  return Object.freeze({ showKind, scroll, width, textWidth: width - NAME_LABEL.padding })
}

/** One hold at the start, then a continuous scroll: the offset wraps every full pass with no rest. */
export function marqueeOffset(textWidth: number, elapsedMs: number): number {
  if (textWidth <= NAME_LABEL.textWidth) return 0
  const distance = textWidth + NAME_LABEL.gap
  const travelMs = distance / NAME_LABEL.speed * 1_000
  const withinTravel = Math.max(0, elapsedMs - NAME_LABEL.pauseMs) % travelMs
  // A full pass lands back on 0; floating point can leave it a hair short of travelMs.
  if (withinTravel < 1e-6 || travelMs - withinTravel < 1e-6) return 0
  return -(withinTravel / 1_000 * NAME_LABEL.speed)
}

/** The two copies of a long name: the second follows the first one gap behind, so the clip never empties. */
export function marqueeCopies(textWidth: number, elapsedMs: number): readonly [number, number] {
  const first = marqueeOffset(textWidth, elapsedMs)
  return Object.freeze([first, first + textWidth + NAME_LABEL.gap]) as readonly [number, number]
}
