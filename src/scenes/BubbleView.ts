import { positionBubbleCard, type BubblePoint, type BubbleSize } from '../bubble-position.ts'
import { ROOM_RESIDENT_SIZE } from '../room-appearance.ts'
import { pagedBubbleFrame, speechPagePlan, type BubbleShape, type PagedBubbleFrame, type SpeechBubble,
  type SpeechPageMoment } from '../speech.ts'
import { speechPauseAt } from '../speech-pause.ts'

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
  private lastFrame: PagedBubbleFrame | null = null
  private lastWidth = -1
  private lastHeight = -1
  private lastPlan: readonly SpeechPageMoment[] | null = null
  private measuredHeight = -1

  constructor(residentId: number) {
    const layer = document.querySelector<HTMLElement>('#speech-layer')
    if (!layer) throw new Error('The speech layer is missing.')
    this.card = document.createElement('div')
    this.card.className = 'room-speech-card'
    this.card.style.display = 'none'
    this.card.style.font = FONT
    this.card.style.lineHeight = '20px'
    this.card.style.boxSizing = 'border-box'
    this.card.dataset['residentId'] = String(residentId)
    this.words = document.createElement('div')
    this.words.className = 'room-speech-words'
    this.card.append(this.words)
    layer.append(this.card)
  }

  update(bubble: SpeechBubble | null, speaker: BubblePoint, viewport: BubbleSize, shape: BubbleShape,
    now: number, opacity = 1): PagedBubbleFrame | null {
    if (!bubble) {
      setStyle(this.card, 'display', 'none')
      this.lastBubble = null
      this.lastFrame = null
      this.lastPlan = null
      return null
    }
    const availableWidth = Math.max(1, viewport.width - 16)
    const availableHeight = Math.max(40, viewport.height - 16)
    if (this.lastBubble !== bubble || this.lastWidth !== availableWidth || this.lastHeight !== availableHeight || !this.lastPlan) {
      this.lastPlan = speechPagePlan(bubble, availableWidth, availableHeight, measureText)
      this.lastWidth = availableWidth; this.lastHeight = availableHeight
    }
    const frame = pagedBubbleFrame(bubble, now, availableWidth, availableHeight, measureText, this.lastPlan)
    const unchangedFrame = this.lastBubble === bubble && this.lastFrame?.revealed === frame.revealed
      && this.lastFrame.page === frame.page && this.lastFrame.width === frame.width && this.lastFrame.height === frame.height
    if (!unchangedFrame) this.words.textContent = frame.text
    this.lastBubble = bubble; this.lastFrame = frame
    setStyle(this.card, 'display', '')
    setStyle(this.card, 'width', `${frame.width}px`)
    setStyle(this.card, 'height', 'auto')
    setStyle(this.card, 'minHeight', `${frame.height}px`)
    if (!unchangedFrame || this.measuredHeight < 0) this.measuredHeight = this.card.getBoundingClientRect().height
    const actualHeight = Number.isFinite(this.measuredHeight) && this.measuredHeight > 0
      ? Math.max(frame.height, this.measuredHeight) : frame.height
    const position = positionBubbleCard(speaker, { width: frame.width, height: actualHeight }, viewport, ROOM_RESIDENT_SIZE)
    setStyle(this.card, 'left', `${position.x}px`)
    setStyle(this.card, 'top', `${position.y}px`)
    setStyle(this.card, 'opacity', String(Math.min(1, Math.max(0, opacity))))
    setCustomStyle(this.card, '--speech-tail-x', `${position.tailX - position.x}px`)
    setCustomStyle(this.card, '--speech-tail-y', `${position.tailY - position.y}px`)
    setDataset(this.card, 'side', position.side)
    setDataset(this.card, 'shape', shape)
    setDataset(this.card, 'complete', String(frame.complete))
    setDataset(this.card, 'pageComplete', String(frame.pageComplete))
    setDataset(this.card, 'revealed', frame.revealed)
    setDataset(this.card, 'page', String(frame.page))
    setDataset(this.card, 'pageCount', String(frame.pageCount))
    if (bubble.noteId === undefined) deleteDataset(this.card, 'noteId')
    else setDataset(this.card, 'noteId', String(bubble.noteId))
    return frame
  }

  pauseAt(now: number): number {
    if (this.card.style.display === 'none') return now
    return speechPauseAt(this.lastBubble, this.lastPlan, now)
  }

  destroy(): void { this.card.remove() }
}

export function positionSpeechLayer(): boolean {
  const shown = [...document.querySelectorAll<HTMLElement>('.room-speech-card')]
    .some(card => card.style.display !== 'none')
  if (!shown) return false
  const app = document.querySelector<HTMLElement>('#app')
  const layer = document.querySelector<HTMLElement>('#speech-layer')
  if (!app || !layer) return false
  setStyle(layer, 'left', `${app.offsetLeft}px`)
  setStyle(layer, 'top', `${app.offsetTop}px`)
  setStyle(layer, 'width', `${app.clientWidth}px`)
  setStyle(layer, 'height', `${app.clientHeight}px`)
  return true
}

function setDataset(element: HTMLElement, key: string, value: string): void {
  if (element.dataset[key] !== value) element.dataset[key] = value
}

function deleteDataset(element: HTMLElement, key: string): void {
  if (key in element.dataset) delete element.dataset[key]
}

function setStyle(element: HTMLElement, key: string, value: string): void {
  const style = element.style as unknown as Record<string, string>
  if (style[key] !== value) style[key] = value
}

function setCustomStyle(element: HTMLElement, key: string, value: string): void {
  if (element.style.getPropertyValue(key) !== value) element.style.setProperty(key, value)
}
