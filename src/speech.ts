import type { ReplayEvent, ReplayPlace } from './city/types.ts'
export type SpeechBubble = Readonly<{ text: string; cut: boolean; placeId: number | null; noteId?: number; startedAt: number; charInterval: number; expiresAt: number }>
export type BubbleShape = 'plain' | 'asking' | 'telling'
export type SpeechCardPlan = Readonly<{ lines: readonly string[]; lineWidth: number; start: number; revealEnd: number; end: number; effectiveCharInterval: number }>
export type SpeechCardFrame = Readonly<{ text: string; revealed: string; lines: readonly string[]; complete: boolean; cut: boolean; width: number; height: number; contentHeight: number; scrollTop: number; fontSize: 14; lineHeight: 20; effectiveCharInterval: number }>
const TYPE_INTERVAL_MS = 34
const TYPE_INTERVAL_FLOOR_MS = 18
const BASE_HOLD_MS = 5_000
const HOLD_FLOOR_MS = 1_500
const READ_AFTER_TYPE_MS = 2_500
const MAX_TOTAL_MS = 15_000
const BASE_SPEED = 120
const MAX_WIDTH = 320
const HORIZONTAL_PADDING = 12
const VERTICAL_PADDING = 10
const LINE_HEIGHT = 20
const holdScale = (speed: number): number => Number.isFinite(speed) && speed > 0 ? BASE_SPEED / speed : 1
export function typingInterval(speed = BASE_SPEED): number {
  return Math.max(TYPE_INTERVAL_FLOOR_MS, TYPE_INTERVAL_MS * holdScale(speed))
}
export function bubbleDuration(speed = BASE_SPEED, characters = 0): number {
  const length = Number.isFinite(characters) ? Math.max(0, Math.floor(characters)) : 0
  const scaledBase = Math.max(HOLD_FLOOR_MS, BASE_HOLD_MS * holdScale(speed))
  const readAfter = Math.max(HOLD_FLOOR_MS, READ_AFTER_TYPE_MS * holdScale(speed))
  return Math.min(MAX_TOTAL_MS, Math.max(scaledBase, length * typingInterval(speed) + readAfter))
}
export function bubbleFor(event: ReplayEvent, shownAt: number, speed = BASE_SPEED): SpeechBubble | null {
  if (event.kind !== 'note' || typeof event.line !== 'string' || event.line.length === 0 || !Number.isFinite(shownAt)) return null
  const placeId = typeof event.detail.place_id === 'number' && Number.isSafeInteger(event.detail.place_id) && event.detail.place_id > 0 ? event.detail.place_id : null
  const noteId = typeof event.detail.note_id === 'number' && Number.isSafeInteger(event.detail.note_id) && event.detail.note_id > 0 ? event.detail.note_id : undefined
  return Object.freeze({ text: event.line, cut: event.line_cut === true, placeId, ...(noteId === undefined ? {} : { noteId }), startedAt: shownAt,
    charInterval: typingInterval(speed), expiresAt: shownAt + bubbleDuration(speed, splitGraphemes(event.line).length) })
}
export function speechCardPlan(bubble: SpeechBubble, availableWidth = MAX_WIDTH,
  measure: (text: string) => number = readableTextWidth, measuredTextWidth?: number): SpeechCardPlan {
  const width = Math.min(MAX_WIDTH, Math.max(1, finiteFloor(availableWidth, MAX_WIDTH)))
  const lineWidth = Math.max(1, measuredTextWidth ?? width - HORIZONTAL_PADDING * 2)
  const lines = Object.freeze(wrapGrowingLines(bubble.text, lineWidth, measure))
  const characters = splitGraphemes(bubble.text).length
  const duration = Math.max(1, bubble.expiresAt - bubble.startedAt)
  const typingBudget = Math.min(characters * bubble.charInterval, Math.max(0, duration - READ_AFTER_TYPE_MS))
  return Object.freeze({ lines, lineWidth, start: bubble.startedAt, revealEnd: bubble.startedAt + typingBudget, end: bubble.expiresAt,
    effectiveCharInterval: characters > 0 ? typingBudget / characters : 0 })
}
export function speechCardFrame(bubble: SpeechBubble, now: number, availableWidth = MAX_WIDTH, availableHeight = 200,
  measure: (text: string) => number = readableTextWidth, existingPlan?: SpeechCardPlan): SpeechCardFrame {
  const width = Math.min(MAX_WIDTH, Math.max(1, finiteFloor(availableWidth, MAX_WIDTH)))
  const maxHeight = Math.max(VERTICAL_PADDING * 2 + LINE_HEIGHT, finiteFloor(availableHeight, 200))
  const plan = existingPlan ?? speechCardPlan(bubble, width, measure)
  const graphemes = splitGraphemes(bubble.text)
  const count = now < plan.start ? 0 : now >= plan.revealEnd || plan.effectiveCharInterval === 0
    ? graphemes.length
    : Math.min(graphemes.length, Math.floor((now - plan.start) / plan.effectiveCharInterval) + 1)
  const revealed = graphemes.slice(0, count).join('')
  const lines = Object.freeze(wrapGrowingLines(revealed, plan.lineWidth, measure))
  const contentHeight = VERTICAL_PADDING * 2 + Math.max(1, lines.length) * LINE_HEIGHT
  const completeContentHeight = VERTICAL_PADDING * 2 + Math.max(1, plan.lines.length) * LINE_HEIGHT
  const height = Math.min(maxHeight, completeContentHeight)
  return Object.freeze({ text: revealed, revealed, lines, complete: count === graphemes.length, cut: bubble.cut, width, height, contentHeight,
    scrollTop: speechScrollTop(contentHeight, height), fontSize: 14, lineHeight: LINE_HEIGHT, effectiveCharInterval: plan.effectiveCharInterval })
}

export function speechScrollTop(contentHeight: number, visibleHeight: number): number {
  return Math.max(0, contentHeight - visibleHeight)
}
function finiteFloor(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback
}
function wrapGrowingLines(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  if (!text) return []
  const lines: string[] = []
  const paragraphs = text.split('\n')
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    let line = ''
    for (const chunk of paragraph.match(/[^\S\n]+|\S+/gu) ?? []) {
      if (measure(chunk) <= maxWidth) {
        if (line && chunk.trim() && measure(line + chunk) > maxWidth) {
          lines.push(line)
          line = chunk
        } else line += chunk
        continue
      }
      for (const grapheme of splitGraphemes(chunk)) {
        if (line && measure(line + grapheme) > maxWidth) {
          lines.push(line)
          line = grapheme
        } else line += grapheme
      }
    }
    if (paragraphIndex < paragraphs.length - 1) line += '\n'
    if (line || paragraphIndex < paragraphs.length - 1) lines.push(line)
  }
  return lines
}
export function bubbleShape(placeId: number | null, places: readonly ReplayPlace[]): BubbleShape {
  const place = placeId === null ? undefined : places.find(row => row.id === placeId)
  if (place?.id === 249 && place.name === 'the asking room') return 'asking'
  if (place?.id === 422 && place.name === 'the telling room') return 'telling'
  return 'plain'
}
function readableTextWidth(text: string): number {
  return splitGraphemes(text).reduce((width, character) => width + (/[^\x00-\xff]/u.test(character) ? 14 : 8), 0)
}
export function splitGraphemes(text: string, useSegmenter = true): string[] {
  if (useSegmenter && typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(part => part.segment)
  const result: string[] = []
  for (const character of Array.from(text)) {
    const join = /^\p{Mark}$/u.test(character) || /^[\uFE00-\uFE0F]$/u.test(character) || /^[\u{1F3FB}-\u{1F3FF}]$/u.test(character) || character === '\u200d' || result.at(-1)?.endsWith('\u200d')
    if (join && result.length) result[result.length - 1] += character
    else result.push(character)
  }
  return result
}
