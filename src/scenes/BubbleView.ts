import { positionBubbleCard, type BubblePoint, type BubbleSize } from '../bubble-position.ts'
import { ROOM_RESIDENT_SIZE } from '../room-appearance.ts'
import { growingBubbleFrame, splitGraphemes, type BubbleShape, type GrowingBubbleFrame, type SpeechBubble } from '../speech.ts'

const FONT = '14px Consolas, "Liberation Mono", monospace'
let measurementContext: CanvasRenderingContext2D | null | undefined

function measureText(text: string): number {
  if (measurementContext === undefined) {
    const canvas = document.createElement('canvas')
    measurementContext = canvas.getContext('2d')
    if (measurementContext) measurementContext.font = FONT
  }
  return measurementContext?.measureText(text).width ?? text.length * 8
}

export class BubbleView {
  private readonly card: HTMLDivElement
  private readonly words: HTMLDivElement
  private lastBubble: SpeechBubble | null = null
  private lastCount = -1
  private lastWidth = -1
  private lastFrame: GrowingBubbleFrame | null = null

  constructor(residentId: number) {
    const layer = document.querySelector<HTMLElement>('#speech-layer')
    if (!layer) throw new Error('The speech layer is missing.')
    this.card = document.createElement('div')
    this.card.className = 'room-speech-card'
    this.card.style.display = 'none'
    this.card.style.font = FONT
    this.card.style.lineHeight = '20px'
    this.card.dataset['residentId'] = String(residentId)
    this.words = document.createElement('div')
    this.words.className = 'room-speech-words'
    this.card.append(this.words)
    layer.append(this.card)
  }

  update(bubble: SpeechBubble | null, speaker: BubblePoint, viewport: BubbleSize, shape: BubbleShape,
    now: number, opacity = 1): GrowingBubbleFrame | null {
    if (!bubble) {
      this.card.style.display = 'none'
      return null
    }
    const availableWidth = Math.max(1, viewport.width - 16)
    const characterCount = splitGraphemes(bubble.text).length
    const revealedCount = now < bubble.startedAt ? 0 : Math.min(characterCount,
      Math.floor((now - bubble.startedAt) / bubble.charInterval) + 1)
    const frame = this.lastBubble === bubble && this.lastCount === revealedCount && this.lastWidth === availableWidth && this.lastFrame
      ? this.lastFrame : growingBubbleFrame(bubble, now, availableWidth, measureText)
    this.lastBubble = bubble; this.lastCount = revealedCount; this.lastWidth = availableWidth; this.lastFrame = frame
    this.words.textContent = frame.revealed
    this.card.style.display = ''
    this.card.style.width = `${frame.width}px`
    this.card.style.height = 'auto'
    this.card.style.minHeight = `${frame.height}px`
    const measuredHeight = this.card.getBoundingClientRect().height
    const actualHeight = Number.isFinite(measuredHeight) && measuredHeight > 0 ? Math.max(frame.height, measuredHeight) : frame.height
    const position = positionBubbleCard(speaker, { width: frame.width, height: actualHeight }, viewport, ROOM_RESIDENT_SIZE)
    this.card.style.left = `${position.x}px`
    this.card.style.top = `${position.y}px`
    this.card.style.opacity = String(Math.min(1, Math.max(0, opacity)))
    this.card.style.setProperty('--speech-tail-x', `${position.tailX - position.x}px`)
    this.card.style.setProperty('--speech-tail-y', `${position.tailY - position.y}px`)
    this.card.dataset['side'] = position.side
    this.card.dataset['shape'] = shape
    this.card.dataset['complete'] = String(frame.complete)
    this.card.dataset['revealed'] = frame.revealed
    if (bubble.noteId === undefined) delete this.card.dataset['noteId']
    else this.card.dataset['noteId'] = String(bubble.noteId)
    return frame
  }

  destroy(): void { this.card.remove() }
}

export function updateSpeechOverflow(): number {
  const app = document.querySelector<HTMLElement>('#app')
  const layer = document.querySelector<HTMLElement>('#speech-layer')
  if (!app || !layer) return 0
  layer.style.left = `${app.offsetLeft}px`
  layer.style.top = `${app.offsetTop}px`
  layer.style.width = `${app.clientWidth}px`
  layer.style.height = `${app.clientHeight}px`
  const appBottom = app.getBoundingClientRect().bottom
  let cardBottom = appBottom
  for (const card of document.querySelectorAll<HTMLElement>('.room-speech-card')) {
    if (card.style.display !== 'none') cardBottom = Math.max(cardBottom, card.getBoundingClientRect().bottom)
  }
  const overflow = Math.max(0, Math.ceil(cardBottom - appBottom))
  document.documentElement.style.setProperty('--speech-overflow', `${overflow}px`)
  document.documentElement.dataset['tallSpeech'] = String(overflow > 0)
  return overflow
}
