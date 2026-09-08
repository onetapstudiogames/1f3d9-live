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

export function mountActivityLog(context: ActivityContext, portraits: PixelPortrait): ActivityLog {
  const panel = document.getElementById('activity-panel')!
  const toggle = document.querySelector<HTMLButtonElement>('#activity-toggle')!
  const filter = document.querySelector<HTMLSelectElement>('#activity-filter')!
  const list = document.getElementById('activity-list')!
  const open = !window.matchMedia('(max-width: 600px)').matches
  toggle.setAttribute('aria-expanded', String(open)); filter.hidden = !open; list.hidden = !open
  return new ActivityLog({ panel, toggle, filter, list }, context, portraits)
}

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
    this.elements.toggle.textContent = 'Recent activity'
    this.render()
  }

  private render(): void {
    const list = this.elements.list
    const stayAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= 24
    const anchor = Array.from(list.children).find(node => (node as HTMLElement).offsetTop + (node as HTMLElement).offsetHeight > list.scrollTop) as HTMLElement | undefined
    const anchorOffset = anchor ? anchor.offsetTop - list.scrollTop : 0
    const generation = ++this.generation
    if (this.elements.toggle.getAttribute('aria-expanded') === 'false') { list.replaceChildren(); return }
    const filter: ActivityFilter = this.elements.filter.value === 'chats' ? 'chats' : 'all'
    const entries = activityVisible(this.state.entries, filter)
    const nodes = entries.map(entry => {
      const row = document.createElement('div'); row.className = 'activity-row'; row.dataset['activityKey'] = entry.key
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
    else if (anchor) {
      const retained = nodes.find(row => row.dataset['activityKey'] === anchor.dataset['activityKey'])
      if (retained) list.scrollTop = retained.offsetTop - anchorOffset
    }
  }
}
