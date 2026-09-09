import { activeActionCaptions, layoutActionCaptions, type ActionCaption, type CaptionResident, type SpeechRect } from '../action-captions.ts'

export class CaptionLayer {
  private readonly cards = new Map<string, HTMLDivElement>()

  update(captions: readonly ActionCaption[], residents: Readonly<Record<number, CaptionResident>>,
    viewport: Readonly<{ width: number; height: number }>, now: number, speech: readonly SpeechRect[]): void {
    const layer = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('#speech-layer')
    if (!layer) return
    const frames = layoutActionCaptions(activeActionCaptions(captions, now), residents, viewport, speech)
    const shown = new Set(frames.map(frame => frame.key))
    for (const [key, card] of this.cards) if (!shown.has(key)) { card.remove(); this.cards.delete(key) }
    for (const frame of frames) {
      let card = this.cards.get(frame.key)
      if (!card) {
        card = document.createElement('div'); card.className = 'room-action-caption'
        card.dataset['residentId'] = String(frame.residentId); card.textContent = frame.text
        layer.append(card); this.cards.set(frame.key, card)
      }
      card.style.left = `${frame.x}px`; card.style.top = `${frame.y}px`
      card.style.width = `${frame.width}px`; card.style.height = `${frame.height}px`
    }
  }

  clear(): void { for (const card of this.cards.values()) card.remove(); this.cards.clear() }
  destroy(): void { this.clear() }
}
