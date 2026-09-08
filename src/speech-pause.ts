import { splitGraphemes, type SpeechBubble, type SpeechPageMoment } from './speech.ts'

export type PauseAdvance = Readonly<{ delta: number; paused: boolean }>

/** Limits one presentation step to an armed pause deadline. */
export function pauseAdvance(delta: number, now: number, deadline: number | null): PauseAdvance {
  if (deadline === null || now + delta < deadline) return Object.freeze({ delta, paused: false })
  return Object.freeze({ delta: Math.max(0, deadline - now), paused: true })
}

/**
 * Returns the absolute presentation time at which Pause may freeze speech.
 * `plan` must be the measured SpeechPageMoment[] used for the visible BubbleView.
 * The result completes the current sentence or measured display line and never
 * advances beyond the current page's reveal/hold window.
 */
export function speechPauseAt(
  bubble: SpeechBubble | null,
  plan: readonly SpeechPageMoment[] | null | undefined,
  now: number,
): number {
  if (!bubble || !plan?.length || !Number.isFinite(now)) return now
  const moment = plan.find(page => now >= page.start && now < page.end)
  if (!moment || now >= moment.revealEnd) return now
  const graphemes = splitGraphemes(moment.lines.join(''))
  if (!graphemes.length || moment.revealEnd <= moment.start) return now
  const revealSpan = moment.revealEnd - moment.start
  const revealedCount = Math.min(graphemes.length,
    Math.max(0, Math.floor((now - moment.start) / (revealSpan / graphemes.length)) + 1))
  const boundary = pauseBoundaries(moment.lines)
    .find(index => index >= revealedCount)
  if (boundary === undefined) return Math.max(now, Math.min(moment.revealEnd, moment.end))
  // pagedBubbleFrame reveals grapheme one at page.start, then one more at each
  // interval. Subtract one interval so the boundary itself does not leak the
  // first grapheme following a completed sentence or line.
  const target = moment.start + revealSpan * (boundary - 1) / graphemes.length
  return Math.max(now, Math.min(target, moment.revealEnd, moment.end))
}

function pauseBoundaries(lines: readonly string[]): number[] {
  const all = splitGraphemes(lines.join(''))
  const boundaries = new Set<number>()
  let offset = 0
  for (const line of lines) {
    const lineLength = splitGraphemes(line).length
    offset += lineLength
    const previous = all[offset - 1]
    const next = all[offset]
    if (previous?.endsWith('\n') || !continuesWord(previous, next)) boundaries.add(offset)
  }
  for (let index = 0; index < all.length; index += 1) {
    if (!/[.!?。！？]/u.test(all[index]!)) continue
    let end = index + 1
    while (end < all.length && /^["'’”)}\]]$/u.test(all[end]!)) end += 1
    if (/[。！？]/u.test(all[index]!) || end === all.length || /^\s$/u.test(all[end]!)) boundaries.add(end)
  }
  return [...boundaries].filter(index => index > 0).sort((left, right) => left - right)
}

function continuesWord(previous: string | undefined, next: string | undefined): boolean {
  return previous !== undefined && next !== undefined && /[\p{Letter}\p{Number}]$/u.test(previous)
    && /^[\p{Letter}\p{Number}]/u.test(next)
}
