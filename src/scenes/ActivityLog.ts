import type { ReplayEvent } from '../city/types.ts'
import { activityReduce, activityVisible, emptyActivity, type ActivityContext, type ActivityFilter,
  type ActivityState } from '../activity.ts'
import { PixelPortrait } from './PixelPortrait.ts'

export type ActivityElements = Readonly<{
  panel: HTMLElement
  toggle: HTMLButtonElement
  filter: HTMLSelectElement
  list: HTMLElement
}>

function paint(canvas: HTMLCanvasElement, cells: Awaited<ReturnType<PixelPortrait['load']>>): void {
  const context = canvas.getContext('2d')
  if (!context) return
  context.imageSmoothingEnabled = false; context.clearRect(0, 0, 8, 8)
  for (const cell of cells) { context.fillStyle = `#${cell.color.toString(16).padStart(6, '0')}`; context.fillRect(cell.x, cell.y, 1, 1) }
}

export class ActivityLog {
  private readonly elements: ActivityElements
  private readonly context: ActivityContext
  private readonly portraits: PixelPortrait
  private state: ActivityState = emptyActivity()
  private generation = 0
  private readonly toggled = (): void => this.setOpen(this.elements.toggle.getAttribute('aria-expanded') !== 'true')
  private readonly filtered = (): void => this.render()

  constructor(elements: ActivityElements, context: ActivityContext, portraits: PixelPortrait) {
    this.elements = elements; this.context = context; this.portraits = portraits
    elements.toggle.addEventListener('click', this.toggled)
    elements.filter.addEventListener('change', this.filtered)
  }

  append(rows: readonly ReplayEvent[], recordedNow: number): void {
    const next = activityReduce(this.state, rows, recordedNow, this.context)
    if (next === this.state) return
    this.state = next; this.render()
  }

  reset(rows: readonly ReplayEvent[] = [], recordedNow = Number.NEGATIVE_INFINITY): void {
    this.state = activityReduce(emptyActivity(), rows, recordedNow, this.context); this.render()
  }

  destroy(): void {
    this.generation += 1
    this.elements.toggle.removeEventListener('click', this.toggled)
    this.elements.filter.removeEventListener('change', this.filtered)
    this.elements.list.replaceChildren()
  }

  private setOpen(open: boolean): void {
    this.elements.toggle.setAttribute('aria-expanded', String(open))
    this.elements.panel.dataset['open'] = String(open)
    this.elements.filter.hidden = !open; this.elements.list.hidden = !open
    this.elements.toggle.textContent = open ? 'Hide recent activity' : 'Show recent activity'
  }

  private render(): void {
    const list = this.elements.list
    const stayAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= 24
    const generation = ++this.generation
    const filter: ActivityFilter = this.elements.filter.value === 'chats' ? 'chats' : 'all'
    const entries = activityVisible(this.state.entries, filter)
    const nodes = entries.map(entry => {
      const row = document.createElement('li'); row.className = 'activity-row'; row.dataset['activityKey'] = entry.key
      const time = document.createElement('time'); time.dateTime = new Date(entry.time).toISOString()
      time.textContent = new Date(entry.time).toISOString().slice(11, 16)
      const words = document.createElement('span'); words.className = 'activity-text'; words.textContent = entry.text
      const icons = document.createElement('span'); icons.className = 'activity-icons'
      for (const entity of entry.entities) {
        const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8
        canvas.className = 'activity-icon'; canvas.setAttribute('role', 'img')
        canvas.setAttribute('aria-label', `${entity.type}: ${entity.name}`); icons.append(canvas)
        void this.portraits.load(entity).then(cells => {
          if (generation === this.generation && canvas.isConnected
            && this.state.entries.some(current => current.key === entry.key)) paint(canvas, cells)
        })
      }
      row.append(time, icons, words); return row
    })
    list.replaceChildren(...nodes)
    if (stayAtBottom) list.scrollTop = list.scrollHeight
  }
}
