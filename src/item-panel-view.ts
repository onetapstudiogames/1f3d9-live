import { itemPanelPlacement, type ItemPanelFact, type ItemPanelRect } from './item-panel.ts'

export type ItemPanelDetails = Readonly<{
  key: string
  kind: 'resident' | 'thing'
  name: string
  id: number
  imageUrl: string
  imageAlt: string
  facts: readonly ItemPanelFact[]
  recordUrl: string
  recordLabel: string
}>

export class ItemPanelView {
  private readonly root = document.querySelector<HTMLElement>('#item-panel')!
  private readonly image = document.querySelector<HTMLImageElement>('#item-panel-image')!
  private readonly title = document.querySelector<HTMLElement>('#item-panel-title')!
  private readonly idLabel = document.querySelector<HTMLElement>('#item-panel-id')!
  private readonly facts = document.querySelector<HTMLDListElement>('#item-panel-facts')!
  private readonly record = document.querySelector<HTMLAnchorElement>('#item-panel-record')!
  private readonly closeButton = document.querySelector<HTMLButtonElement>('#item-panel-close')!
  private readonly app = document.querySelector<HTMLElement>('#app')!
  private anchor: ItemPanelRect | null = null
  private key: string | null = null

  constructor() {
    this.closeButton.addEventListener('click', this.close)
    this.root.addEventListener('mousedown', this.onPanelInput)
    this.root.addEventListener('touchstart', this.onPanelInput)
    document.addEventListener('pointerdown', this.onPointerDown, true)
    document.addEventListener('keydown', this.onKeyDown, true)
    window.addEventListener('resize', this.reposition)
  }

  open(details: ItemPanelDetails, anchor: ItemPanelRect): void {
    this.key = details.key
    this.anchor = anchor
    this.render(details)
    this.root.hidden = false
    this.reposition()
  }

  update(details: ItemPanelDetails): boolean {
    if (this.root.hidden || this.key !== details.key) return false
    this.render(details)
    this.reposition()
    return true
  }

  isOpenFor(key: string): boolean {
    return !this.root.hidden && this.key === key
  }

  close = (): void => {
    if (this.root.hidden) return
    this.root.hidden = true
    this.root.removeAttribute('data-side')
    this.root.removeAttribute('data-item-kind')
    this.image.removeAttribute('src')
    this.image.alt = ''
    this.title.textContent = ''
    this.idLabel.textContent = ''
    this.facts.replaceChildren()
    this.record.removeAttribute('href')
    this.record.textContent = ''
    this.key = null
    this.anchor = null
  }

  destroy(): void {
    this.close()
    this.closeButton.removeEventListener('click', this.close)
    this.root.removeEventListener('mousedown', this.onPanelInput)
    this.root.removeEventListener('touchstart', this.onPanelInput)
    document.removeEventListener('pointerdown', this.onPointerDown, true)
    document.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('resize', this.reposition)
  }

  private render(details: ItemPanelDetails): void {
    this.root.dataset['itemKind'] = details.kind
    this.image.src = details.imageUrl
    this.image.alt = details.imageAlt
    this.title.textContent = details.name || (details.kind === 'resident' ? 'Resident' : 'Thing')
    this.idLabel.textContent = details.kind === 'resident' ? `resident #${details.id}` : `Thing #${details.id}`
    const rows = details.facts.flatMap(fact => {
      const term = document.createElement('dt')
      const value = document.createElement('dd')
      term.textContent = fact.label
      value.textContent = fact.value
      return [term, value]
    })
    this.facts.replaceChildren(...rows)
    this.record.href = details.recordUrl
    this.record.textContent = details.recordLabel
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.root.hidden || !(event.target instanceof Node) || this.root.contains(event.target)) return
    this.close()
  }

  private readonly onPanelInput = (event: Event): void => {
    // Phaser listens for mouse and touch input on window as well as the canvas.
    // Keep panel controls from becoming sprite clicks while still allowing their own handlers.
    event.stopPropagation()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.root.hidden) return
    event.preventDefault()
    event.stopPropagation()
    this.close()
  }

  private readonly reposition = (): void => {
    if (this.root.hidden || !this.anchor) return
    const appBox = this.app.getBoundingClientRect()
    const viewport: ItemPanelRect = {
      left: appBox.left + this.app.clientLeft,
      top: appBox.top + this.app.clientTop,
      right: appBox.left + this.app.clientLeft + this.app.clientWidth,
      bottom: appBox.top + this.app.clientTop + this.app.clientHeight,
    }
    const box = this.root.getBoundingClientRect()
    const placement = itemPanelPlacement(this.anchor, { width: box.width, height: box.height }, viewport)
    if (!placement) {
      this.close()
      return
    }
    this.root.style.left = `${placement.left}px`
    this.root.style.top = `${placement.top}px`
    this.root.dataset['side'] = placement.side
  }
}
