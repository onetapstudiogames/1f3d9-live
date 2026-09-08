import { splitGraphemes, type SpeechBubble, type SpeechCardPlan } from './speech.ts'
export type PauseAdvance = Readonly<{ delta: number; paused: boolean }>
export function pauseAdvance(delta: number, now: number, deadline: number | null): PauseAdvance {
  if (deadline === null || now + delta < deadline) return Object.freeze({ delta, paused: false })
  return Object.freeze({ delta: Math.max(0, deadline - now), paused: true })
}
export function speechPauseAt(bubble: SpeechBubble | null, plan: SpeechCardPlan | null | undefined, now: number): number {
  if (!bubble || !plan || !Number.isFinite(now) || now < plan.start || now >= plan.revealEnd || plan.effectiveCharInterval <= 0) return now
  const graphemes = splitGraphemes(bubble.text)
  const revealedCount = Math.min(graphemes.length,
    Math.max(0, Math.floor((now - plan.start) / plan.effectiveCharInterval) + 1))
  const boundary = pauseBoundaries(plan.lines).find(index => index >= revealedCount)
  if (boundary === undefined) return Math.max(now, plan.revealEnd)
  return Math.max(now, Math.min(plan.start + plan.effectiveCharInterval * (boundary - 1), plan.revealEnd))
}
function pauseBoundaries(lines: readonly string[]): number[] {
  const all = splitGraphemes(lines.join(''))
  const boundaries = new Set<number>()
  let offset = 0
  for (const line of lines) {
    offset += splitGraphemes(line).length
    const previous = all[offset - 1]
    const next = all[offset]
    if (previous?.endsWith('\n') || !continuesWord(previous, next)) boundaries.add(offset)
  }
  for (let index = 0; index < all.length; index += 1) {
    if (!/[.!?。！？]/u.test(all[index]!)) continue
    let end = index + 1
    while (end < all.length && /^["'’”)}\]]$/u.test(all[end]!)) end += 1
    const endsSentence = /[。！？]/u.test(all[index]!) || end === all.length || /^\s$/u.test(all[end]!)
    if (endsSentence && !isPeriodAbbreviation(all, index)) boundaries.add(end)
  }
  return [...boundaries].filter(index => index > 0).sort((left, right) => left - right)
}
function isPeriodAbbreviation(graphemes: readonly string[], periodIndex: number): boolean {
  if (graphemes[periodIndex] !== '.') return false
  const token = graphemes.slice(0, periodIndex + 1).join('').match(/[\p{Letter}.]+$/u)?.[0]
  return token !== undefined
    && (/^(?:Dr|Jr|Mr|Mrs|Ms|Sr|St)\.$/u.test(token) || /^(?:\p{Letter}\.){2,}$/u.test(token))
}

function continuesWord(previous: string | undefined, next: string | undefined): boolean {
  return previous !== undefined && next !== undefined && /[\p{Letter}\p{Number}]$/u.test(previous)
    && /^[\p{Letter}\p{Number}]/u.test(next)
}
