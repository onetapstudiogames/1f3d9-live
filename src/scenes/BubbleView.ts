import { positionBubbleCard, type BubblePoint, type BubbleSize } from '../bubble-position.ts'
import { ROOM_RESIDENT_SIZE } from '../room-appearance.ts'
import { speechCardFrame, speechCardPlan, speechScrollTop, type BubbleShape, type SpeechBubble, type SpeechCardFrame,
  type SpeechCardPlan } from '../speech.ts'
import type { SpeechRect } from '../action-captions.ts'

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
  private lastFrame: SpeechCardFrame | null = null
  private lastWidth = -1
  private lastHeight = -1
  private lastPlan: SpeechCardPlan | null = null

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
    now: number, opacity = 1): SpeechCardFrame | null {
    if (!bubble) {
      setStyle(this.card, 'display', 'none')
      this.lastBubble = null
      this.lastFrame = null
      this.lastPlan = null
      return null
    }
    const availableWidth = Math.min(240, Math.max(1, viewport.width - 16))
    const availableHeight = Math.max(40, viewport.height - 16)
    if (this.lastBubble !== bubble || this.lastWidth !== availableWidth || this.lastHeight !== availableHeight || !this.lastPlan) {
      setStyle(this.card, 'display', '')
      setStyle(this.card, 'width', `${availableWidth}px`)
      // The reserved scrollbar gutter is part of the actual text width.
      this.lastPlan = speechCardPlan(bubble, availableWidth, measureText, this.words.clientWidth)
      this.lastWidth = availableWidth; this.lastHeight = availableHeight
    }
    const frame = speechCardFrame(bubble, now, availableWidth, availableHeight, measureText, this.lastPlan)
    const unchangedFrame = this.lastBubble === bubble && this.lastFrame?.revealed === frame.revealed
      && this.lastFrame.width === frame.width && this.lastFrame.height === frame.height
    if (!unchangedFrame) this.words.textContent = frame.text
    this.lastBubble = bubble; this.lastFrame = frame
    setStyle(this.card, 'display', '')
    setStyle(this.card, 'width', `${frame.width}px`)
    setStyle(this.card, 'height', `${frame.height}px`)
    if (!unchangedFrame) {
      this.words.scrollTop = speechScrollTop(this.words.scrollHeight, this.words.clientHeight)
    }
    const position = positionBubbleCard(speaker, { width: frame.width, height: frame.height }, viewport, ROOM_RESIDENT_SIZE)
    setStyle(this.card, 'left', `${position.x}px`)
    setStyle(this.card, 'top', `${position.y}px`)
    setStyle(this.card, 'opacity', String(Math.min(1, Math.max(0, opacity))))
    setCustomStyle(this.card, '--speech-tail-x', `${position.tailX - position.x}px`)
    setCustomStyle(this.card, '--speech-tail-y', `${position.tailY - position.y}px`)
    setDataset(this.card, 'side', position.side)
    setDataset(this.card, 'shape', shape)
    setDataset(this.card, 'complete', String(frame.complete))
    setDataset(this.card, 'revealed', frame.revealed)
    if (bubble.noteId === undefined) deleteDataset(this.card, 'noteId')
    else setDataset(this.card, 'noteId', String(bubble.noteId))
    return frame
  }

  destroy(): void { this.card.remove() }
}

export function positionSpeechLayer(): boolean {
  const shown = [...document.querySelectorAll<HTMLElement>('.room-speech-card, .room-action-caption')]
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

export function visibleSpeechCardRects(captionResidents: ReadonlySet<number> = new Set(), viewportHeight?: number,
  captionLaneHeight = 86): readonly SpeechRect[] {
  if (typeof document === 'undefined') return Object.freeze([])
  const layer = document.querySelector<HTMLElement>('#speech-layer')
  if (!layer) return Object.freeze([])
  const origin = layer.getBoundingClientRect?.() ?? { left: 0, top: 0 }
  return Object.freeze([...document.querySelectorAll<HTMLElement>('.room-speech-card')].flatMap(card => {
    const residentId = Number(card.dataset['residentId'])
    if (card.style.display === 'none' || !Number.isSafeInteger(residentId)) return []
    if (captionResidents.has(residentId) && Number.isFinite(viewportHeight)) {
      const top = Number.parseFloat(card.style.top) || 8
      const reservedBottom = Math.max(16, captionLaneHeight)
      const maximum = Math.max(40, viewportHeight! - top - reservedBottom)
      const current = Number.parseFloat(card.style.height)
      if (Number.isFinite(current) && current > maximum) {
        const words = card.querySelector?.<HTMLElement>('.room-speech-words') ?? card.children?.[0] as HTMLElement | undefined
        const followedBottom = words ? words.scrollTop + words.clientHeight >= words.scrollHeight - 1 : false
        card.style.height = `${maximum}px`
        if (words && followedBottom) words.scrollTop = Math.max(0, words.scrollHeight - words.clientHeight)
      }
    }
    const rect = card.getBoundingClientRect()
    const left = Number.isFinite(rect.left) ? rect.left : Number.parseFloat(card.style.left) || 0
    const top = Number.isFinite(rect.top) ? rect.top : Number.parseFloat(card.style.top) || 0
    const width = Number.isFinite(rect.width) ? rect.width : Number.parseFloat(card.style.width) || 0
    const height = Number.isFinite(rect.height) ? rect.height : Number.parseFloat(card.style.height) || 0
    return [{ residentId, x: left - (Number(origin.left) || 0), y: top - (Number(origin.top) || 0), width, height }]
  }))
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
