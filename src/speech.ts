import type { ReplayEvent, ReplayPlace } from './city/types.ts'

export type SpeechBubble = Readonly<{ text: string; cut: boolean; placeId: number | null; noteId?: number; startedAt: number;
  charInterval: number; expiresAt: number }>
export type BubbleShape = 'plain' | 'asking' | 'telling'
export type SpeechPageMoment = Readonly<{ lines: readonly string[]; start: number; revealEnd: number; end: number }>
export type PagedBubbleFrame = Readonly<{ text: string; revealed: string; lines: readonly string[]; pages: readonly (readonly string[])[];
  page: number; pageCount: number; complete: boolean; pageComplete: boolean; cut: boolean; width: number; height: number;
  fontSize: 14; lineHeight: 20; effectiveCharInterval: number }>

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
const TARGET_PAGE_HOLD_MS = 2_500
const holdScale = (speed: number): number => Number.isFinite(speed) && speed > 0 ? BASE_SPEED / speed : 1

export function typingInterval(speed: number = BASE_SPEED): number {
  return Math.max(TYPE_INTERVAL_FLOOR_MS, TYPE_INTERVAL_MS * holdScale(speed))
}

export function bubbleDuration(speed: number = BASE_SPEED, characters = 0): number {
  const length = Number.isFinite(characters) ? Math.max(0, Math.floor(characters)) : 0
  const scaledBase = Math.max(HOLD_FLOOR_MS, BASE_HOLD_MS * holdScale(speed))
  const readAfter = Math.max(HOLD_FLOOR_MS, READ_AFTER_TYPE_MS * holdScale(speed))
  return Math.min(MAX_TOTAL_MS, Math.max(scaledBase, length * typingInterval(speed) + readAfter))
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

export function speechPagePlan(bubble: SpeechBubble, availableWidth = MAX_WIDTH, availableHeight = 200,
  measure: (text: string) => number = readableTextWidth): readonly SpeechPageMoment[] {
  const width = Math.min(MAX_WIDTH, Math.max(1, finiteFloor(availableWidth, MAX_WIDTH)))
  const height = Math.max(VERTICAL_PADDING * 2 + LINE_HEIGHT, finiteFloor(availableHeight, 200))
  const lines = wrapGrowingLines(bubble.text, Math.max(1, width - HORIZONTAL_PADDING * 2), measure)
  const linesPerPage = Math.max(1, Math.floor((height - VERTICAL_PADDING * 2) / LINE_HEIGHT))
  const pages: string[][] = []
  for (let index = 0; index < lines.length; index += linesPerPage) pages.push(lines.slice(index, index + linesPerPage))
  if (pages.length === 0) pages.push([])
  const duration = Math.max(1, bubble.expiresAt - bubble.startedAt)
  const counts = pages.map(page => splitGraphemes(page.join('')).length)
  const totalCharacters = Math.max(1, counts.reduce((sum, count) => sum + count, 0))
  const reservedHold = Math.min(duration * .5, pages.length * TARGET_PAGE_HOLD_MS)
  const availableTypingBudget = Math.max(0, duration - reservedHold)
  const typingBudget = Math.min(availableTypingBudget, totalCharacters * bubble.charInterval)
  const holdBudget = duration - typingBudget
  let cursor = bubble.startedAt
  return Object.freeze(pages.map((lines, index) => {
    const typing = typingBudget * counts[index]! / totalCharacters
    const end = index === pages.length - 1 ? bubble.expiresAt : cursor + typing + holdBudget / pages.length
    const moment = Object.freeze({ lines: Object.freeze(lines), start: cursor, revealEnd: cursor + typing, end })
    cursor = end
    return moment
  }))
}

export function pagedBubbleFrame(bubble: SpeechBubble, now: number, availableWidth = MAX_WIDTH, availableHeight = 200,
  measure: (text: string) => number = readableTextWidth, existingPlan?: readonly SpeechPageMoment[]): PagedBubbleFrame {
  const width = Math.min(MAX_WIDTH, Math.max(1, finiteFloor(availableWidth, MAX_WIDTH)))
  const plan = existingPlan ?? speechPagePlan(bubble, width, availableHeight, measure)
  const matchingPage = plan.findIndex(item => now < item.end)
  const page = now < bubble.startedAt ? 0 : matchingPage < 0 ? plan.length - 1 : matchingPage
  const moment = plan[page]!
  const pageText = moment.lines.join('')
  const characters = splitGraphemes(pageText)
  const revealSpan = Math.max(0, moment.revealEnd - moment.start)
  const effectiveCharInterval = characters.length > 0 ? revealSpan / characters.length : 0
  const count = now < moment.start ? 0 : now >= moment.revealEnd || effectiveCharInterval === 0 ? characters.length
    : Math.min(characters.length, Math.floor((now - moment.start) / effectiveCharInterval) + 1)
  const revealed = characters.slice(0, count).join('')
  const visibleLines = wrapGrowingLines(revealed, Math.max(1, width - HORIZONTAL_PADDING * 2), measure)
  return Object.freeze({ text: displayLines(visibleLines), revealed, lines: Object.freeze(visibleLines),
    pages: Object.freeze(plan.map(item => item.lines)), page, pageCount: plan.length,
    complete: page === plan.length - 1 && count === characters.length, pageComplete: count === characters.length, cut: bubble.cut,
    width, height: VERTICAL_PADDING * 2 + Math.max(1, visibleLines.length) * LINE_HEIGHT,
    fontSize: 14, lineHeight: LINE_HEIGHT, effectiveCharInterval })
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
        if (line && chunk.trim() && measure(line + chunk) > maxWidth) { lines.push(line); line = chunk }
        else line += chunk
        continue
      }
      for (const grapheme of splitGraphemes(chunk)) {
        if (line && measure(line + grapheme) > maxWidth) { lines.push(line); line = grapheme }
        else line += grapheme
      }
    }
    if (paragraphIndex < paragraphs.length - 1) line += '\n'
    if (line || paragraphIndex < paragraphs.length - 1) lines.push(line)
  }
  return lines
}

function displayLines(lines: readonly string[]): string {
  return lines.map((line, index) => line + (index < lines.length - 1 && !line.endsWith('\n') ? '\n' : '')).join('')
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
