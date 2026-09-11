export const NAME_LABEL = Object.freeze({
  width: 124,
  height: 23,
  textWidth: 112,
  fontSize: 13,
  padding: 12,
})

export type LabelContent = Readonly<{
  showKind: boolean
  width: number
  textWidth: number
}>

export function labelContent(name: string, kind: string | null, nameWidth: number, kindWidth: number): LabelContent {
  const showKind = name.length > 0 && kind !== null && kind.length > 0
    && nameWidth + kindWidth + 5 <= NAME_LABEL.textWidth
  const contentWidth = nameWidth + (showKind ? kindWidth + 5 : 0)
  const width = Math.min(NAME_LABEL.width, contentWidth + NAME_LABEL.padding)
  return Object.freeze({ showKind, width, textWidth: width - NAME_LABEL.padding })
}

/** Keeps the beginning readable at a glance and uses three plain dots for overflow. */
export function shortenLabelName(name: string, maximumWidth: number,
  measure: (text: string) => number): string {
  if (!name || !Number.isFinite(maximumWidth) || maximumWidth <= 0 || measure(name) <= maximumWidth) return name
  const segments = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name)].map(row => row.segment)
    : Array.from(name)
  const suffix = '...'
  if (measure(suffix) > maximumWidth) return ''
  let low = 0; let high = segments.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (measure(segments.slice(0, middle).join('') + suffix) <= maximumWidth) low = middle
    else high = middle - 1
  }
  return segments.slice(0, low).join('') + suffix
}
