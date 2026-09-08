import type { ReplayEvent, ReplayPlace } from './city/types.ts'

export type SpeechBubble = Readonly<{ text: string; cut: boolean; placeId: number | null; noteId?: number; startedAt: number;
  charInterval: number; expiresAt: number }>
export type BubbleShape = 'plain' | 'asking' | 'telling'
export type BubbleRect = Readonly<{ x: number; y: number; width: number; height: number; color: number; alpha: 1 }>
export type TypedBubbleFrame = Readonly<{ text: string; revealed: string; firstLine: number; complete: boolean; cut: boolean }>
export type GrowingBubbleFrame = Readonly<{ text: string; revealed: string; lines: readonly string[]; complete: boolean;
  cut: boolean; width: number; height: number; fontSize: 14; lineHeight: 20 }>

const TYPE_INTERVAL_MS = 34
const TYPE_INTERVAL_FLOOR_MS = 18
const BASE_HOLD_MS = 5_000
const HOLD_FLOOR_MS = 1_500
const READ_AFTER_TYPE_MS = 2_500
const BASE_SPEED = 120
const holdScale = (speed: number): number => Number.isFinite(speed) && speed > 0 ? BASE_SPEED / speed : 1

export function typingInterval(speed: number = BASE_SPEED): number {
  return Math.max(TYPE_INTERVAL_FLOOR_MS, TYPE_INTERVAL_MS * holdScale(speed))
}

export function bubbleDuration(speed: number = BASE_SPEED, characters = 0): number {
  const length = Number.isFinite(characters) ? Math.max(0, Math.floor(characters)) : 0
  const scaledBase = Math.max(HOLD_FLOOR_MS, BASE_HOLD_MS * holdScale(speed))
  const readAfter = Math.max(HOLD_FLOOR_MS, READ_AFTER_TYPE_MS * holdScale(speed))
  return Math.max(scaledBase, length * typingInterval(speed) + readAfter)
}

export function bubbleFor(event: ReplayEvent, shownAt: number, speed: number = BASE_SPEED): SpeechBubble | null {
  if (event.kind !== 'note' || typeof event.line !== 'string' || event.line.length === 0 || !Number.isFinite(shownAt)) return null
  const placeId = typeof event.detail.place_id === 'number' && Number.isSafeInteger(event.detail.place_id)
    && event.detail.place_id > 0 ? event.detail.place_id : null
  const noteId = typeof event.detail.note_id === 'number' && Number.isSafeInteger(event.detail.note_id) && event.detail.note_id > 0
    ? event.detail.note_id : undefined
  return Object.freeze({ text: event.line, cut: event.line_cut === true, placeId, ...(noteId === undefined ? {} : { noteId }), startedAt: shownAt,
    charInterval: typingInterval(speed), expiresAt: shownAt + bubbleDuration(speed, splitGraphemes(event.line).length) })
}

export function typedBubbleFrame(bubble: SpeechBubble, now: number, maxWidth = 210, visibleLines = 4,
  measure: (text: string) => number = readableTextWidth): TypedBubbleFrame {
  const safeWidth = Math.max(1, maxWidth)
  const safeLines = Math.max(1, Math.floor(visibleLines))
  const characters = splitGraphemes(bubble.text)
  const count = now < bubble.startedAt ? 0 : Math.min(characters.length,
    Math.floor((now - bubble.startedAt) / bubble.charInterval) + 1)
  const visible = characters.slice(0, count).join('')
  const lines = wrapLines(visible, safeWidth, measure)
  const firstLine = Math.max(0, lines.length - safeLines)
  return Object.freeze({ text: lines.slice(firstLine).join('\n'), revealed: visible, firstLine,
    complete: count === characters.length, cut: bubble.cut })
}

const GROWING_BUBBLE_MAX_WIDTH = 320
const GROWING_BUBBLE_HORIZONTAL_PADDING = 12
const GROWING_BUBBLE_VERTICAL_PADDING = 10

/** Lays out every revealed grapheme at a fixed reading size. The card width is capped at
 * 320px and otherwise follows the available viewport; its height adds 20px per line. */
export function growingBubbleFrame(bubble: SpeechBubble, now: number, availableWidth = GROWING_BUBBLE_MAX_WIDTH,
  measure: (text: string) => number = readableTextWidth): GrowingBubbleFrame {
  const finiteWidth = Number.isFinite(availableWidth) ? Math.floor(availableWidth) : GROWING_BUBBLE_MAX_WIDTH
  const width = Math.min(GROWING_BUBBLE_MAX_WIDTH, Math.max(1, finiteWidth))
  const characters = splitGraphemes(bubble.text)
  const count = now < bubble.startedAt ? 0 : Math.min(characters.length,
    Math.floor((now - bubble.startedAt) / bubble.charInterval) + 1)
  const revealed = characters.slice(0, count).join('')
  const lines = wrapGrowingLines(revealed, Math.max(1, width - GROWING_BUBBLE_HORIZONTAL_PADDING * 2), measure)
  return Object.freeze({ text: revealed, revealed, lines: Object.freeze(lines), complete: count === characters.length,
    cut: bubble.cut, width, height: GROWING_BUBBLE_VERTICAL_PADDING * 2 + lines.length * 20, fontSize: 14, lineHeight: 20 })
}

function wrapGrowingLines(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  if (!text) return []
  const lines: string[] = []
  const appendOversized = (chunk: string, initial: string): string => {
    let line = initial
    for (const grapheme of splitGraphemes(chunk)) {
      if (line && measure(line + grapheme) > maxWidth) {
        lines.push(line)
        line = grapheme
      } else line += grapheme
    }
    return line
  }
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { lines.push(''); continue }
    let line = ''
    for (const chunk of paragraph.match(/[^\S\n]+|\S+/gu) ?? []) {
      if (measure(chunk) > maxWidth) line = appendOversized(chunk, line)
      else if (line && measure(line + chunk) > maxWidth) {
        lines.push(line)
        line = chunk
      } else line += chunk
    }
    lines.push(line)
  }
  return lines
}

export function bubbleShape(placeId: number | null, places: readonly ReplayPlace[]): BubbleShape {
  const place = placeId === null ? undefined : places.find(row => row.id === placeId)
  if (place?.id === 249 && place.name === 'the asking room') return 'asking'
  if (place?.id === 422 && place.name === 'the telling room') return 'telling'
  return 'plain'
}

export function bubbleRects(shape: BubbleShape, width: number, height: number): readonly BubbleRect[] {
  const w = Math.max(12, Math.round(width)); const h = Math.max(12, Math.round(height))
  const fill = 0xfff3d6; const edge = 0x6c5838
  const cells: BubbleRect[] = shape === 'telling'
    ? [{ x: 0, y: 0, width: w, height: h, color: fill, alpha: 1 }, { x: 0, y: h - 3, width: w, height: 3, color: edge, alpha: 1 }]
    : [{ x: 3, y: 0, width: w - 6, height: h, color: fill, alpha: 1 },
      { x: 0, y: 3, width: w, height: h - 6, color: fill, alpha: 1 },
      ...(shape === 'asking' ? [{ x: 8, y: h, width: 6, height: 5, color: fill, alpha: 1 } as const,
        { x: 13, y: h + 5, width: 4, height: 4, color: fill, alpha: 1 } as const] : [])]
  return Object.freeze(cells.map(cell => Object.freeze(cell)))
}

export function wrapLines(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  if (!text) return []
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (!paragraph) { lines.push(''); continue }
    let line = ''
    const chunks = paragraph.match(/^\S+|[^\S\n]+\S+|[^\S\n]+$/gu) ?? []
    for (const chunk of chunks) {
      if (line && measure(line + chunk) > maxWidth && chunk.trim().length > 0) {
        lines.push(line)
        line = chunk
      } else {
        line += chunk
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

export function bubbleFitScale(lines: readonly string[], maxWidth: number, measure: (text: string) => number): number {
  const widest = Math.max(0, ...lines.map(measure))
  return widest > maxWidth ? maxWidth / widest : 1
}

function readableTextWidth(text: string): number {
  return splitGraphemes(text).reduce((width, character) => width + (/[^\x00-\xff]/u.test(character) ? 14 : 8), 0)
}

export function splitGraphemes(text: string, useSegmenter = true): string[] {
  if (useSegmenter && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    return [...segmenter.segment(text)].map(part => part.segment)
  }
  const result: string[] = []
  for (const character of Array.from(text)) {
    const join = /^\p{Mark}$/u.test(character) || /^[\uFE00-\uFE0F]$/u.test(character)
      || /^[\u{1F3FB}-\u{1F3FF}]$/u.test(character) || character === '\u200d' || result.at(-1)?.endsWith('\u200d')
    if (join && result.length) result[result.length - 1] += character
    else result.push(character)
  }
  return result
}
