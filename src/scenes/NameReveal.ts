import type { NameLabelBounds } from './NameLabel.ts'

export class NameReveal {
  private readonly layer: HTMLElement | null
  private readonly hit: HTMLSpanElement | null
  private readonly bubble: HTMLDivElement | null

  constructor(name: string) {
    const layer = typeof document === 'undefined' || typeof document.querySelector !== 'function'
      ? null : document.querySelector<HTMLElement>('#name-layer')
    this.layer = layer
    if (!layer) { this.hit = null; this.bubble = null; return }
    this.hit = document.createElement('span')
    this.hit.setAttribute('role', 'button')
    this.hit.tabIndex = 0
    this.hit.className = 'room-name-hit'
    this.bubble = document.createElement('div')
    this.bubble.className = 'room-name-reveal'
    this.bubble.setAttribute('role', 'tooltip')
    this.hit.addEventListener('click', () => {
      this.hit!.dataset['open'] = String(this.hit!.dataset['open'] !== 'true')
    })
    this.hit.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault(); this.hit!.click()
    })
    this.hit.addEventListener('blur', () => { this.hit!.dataset['open'] = 'false' })
    layer.append(this.hit, this.bubble)
    this.setContent(name)
    this.setVisible(false)
  }

  setContent(name: string): void {
    if (!this.hit || !this.bubble) return
    this.hit.setAttribute('aria-label', `Show full name: ${name}`)
    this.hit.title = name
    this.bubble.textContent = name
  }

  update(bounds: NameLabelBounds): void {
    if (!this.hit || !this.bubble) return
    this.hit.style.left = `${bounds.x}px`; this.hit.style.top = `${bounds.y}px`
    this.hit.style.width = `${bounds.width}px`; this.hit.style.height = `${bounds.height}px`
    const maximumWidth = Math.max(1, this.layer!.clientWidth - 16)
    const estimatedWidth = Math.min(maximumWidth, this.bubble.offsetWidth || (this.bubble.textContent?.length ?? 0) * 7 + 16)
    const center = bounds.x + bounds.width / 2
    const left = Math.min(this.layer!.clientWidth - 8 - estimatedWidth / 2,
      Math.max(8 + estimatedWidth / 2, center))
    this.bubble.style.left = `${left}px`; this.bubble.style.right = 'auto'
    this.bubble.style.top = bounds.y < 60 ? `${bounds.y + bounds.height + 4}px` : `${bounds.y - 4}px`
    this.bubble.dataset['side'] = bounds.y < 60 ? 'below' : 'above'
  }

  setVisible(visible: boolean): void {
    if (!this.hit || !this.bubble) return
    this.hit.style.display = visible ? '' : 'none'
    this.bubble.hidden = !visible
    if (!visible) this.hit.dataset['open'] = 'false'
  }

  destroy(): void { this.hit?.remove(); this.bubble?.remove() }
}

export function positionNameLayer(): boolean {
  if (typeof document === 'undefined') return false
  const app = document.querySelector<HTMLElement>('#app')
  const layer = document.querySelector<HTMLElement>('#name-layer')
  if (!app || !layer) return false
  layer.style.left = `${app.offsetLeft}px`; layer.style.top = `${app.offsetTop}px`
  layer.style.width = `${app.clientWidth}px`; layer.style.height = `${app.clientHeight}px`
  return true
}
