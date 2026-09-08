import type { Point } from '../ground/nested.ts'
import { minimapFrame, minimapPlan, minimapWorldPoint, type MiniRect, type MinimapPlan } from '../minimap.ts'
import type { NestedLayout } from '../ground/nested.ts'
import { followScroll } from '../minimap.ts'

export class MinimapView {
  private readonly canvas: HTMLCanvasElement
  private readonly base: HTMLCanvasElement
  private readonly dynamic: HTMLCanvasElement
  private readonly plan: MinimapPlan
  private dynamicKey = ''

  constructor(layout: NestedLayout, foundingIds: ReadonlySet<number>, move: (point: Point) => void) {
    this.plan = minimapPlan(layout, foundingIds)
    this.canvas = document.querySelector<HTMLCanvasElement>('#minimap-canvas')!
    this.canvas.width = this.plan.width; this.canvas.height = this.plan.height
    this.base = document.createElement('canvas'); this.base.width = this.plan.width; this.base.height = this.plan.height
    this.dynamic = document.createElement('canvas'); this.dynamic.width = this.plan.width; this.dynamic.height = this.plan.height
    drawRooms(this.base.getContext('2d')!, this.plan.staticRooms, '#8ba681')
    this.canvas.addEventListener('click', event => {
      const bounds = this.canvas.getBoundingClientRect()
      move(minimapWorldPoint(this.plan, (event.clientX - bounds.left) * this.plan.width / bounds.width,
        (event.clientY - bounds.top) * this.plan.height / bounds.height))
    })
  }

  update(camera: Readonly<{ worldView: Readonly<{ x: number; y: number; width: number; height: number }> }>,
    followed: Point | null, hiddenIds: ReadonlySet<number>): void {
    const context = this.canvas.getContext('2d')!
    const frame = minimapFrame(this.plan, camera.worldView, followed, hiddenIds)
    const key = frame.dynamicRooms.map(room => room.id).join(',')
    if (key !== this.dynamicKey) {
      const dynamic = this.dynamic.getContext('2d')!; dynamic.clearRect(0, 0, this.plan.width, this.plan.height)
      drawRooms(dynamic, frame.dynamicRooms, '#d3c37a'); this.dynamicKey = key
    }
    context.clearRect(0, 0, this.plan.width, this.plan.height)
    context.drawImage(this.base, 0, 0)
    context.drawImage(this.dynamic, 0, 0)
    if (frame.followed) {
      context.fillStyle = '#e2c977'; context.fillRect(Math.round(frame.followed.x) - 2, Math.round(frame.followed.y) - 2, 5, 5)
    }
    const view = frame.viewport
    // Keep the view's edge readable even when it is smaller than the followed marker.
    if (view.width > 0 && view.height > 0) {
      context.strokeStyle = '#ffffff'; context.lineWidth = 1
      context.strokeRect(Math.round(view.x) + 0.5, Math.round(view.y) + 0.5,
        Math.max(1, Math.round(view.width) - 1), Math.max(1, Math.round(view.height) - 1))
    }
    document.body.dataset['liveMinimapView'] = `${Math.round(view.x)},${Math.round(view.y)}`
    document.body.dataset['liveMinimapFollow'] = frame.followed ? `${Math.round(frame.followed.x)},${Math.round(frame.followed.y)}` : ''
  }

  setVisible(visible: boolean): void {
    const panel = document.getElementById('minimap')
    const toggle = document.getElementById('minimap-toggle')
    if (panel) panel.hidden = !visible
    if (toggle) { toggle.textContent = '▦'; toggle.setAttribute('aria-label', visible ? 'Hide map' : 'Show map'); toggle.title = visible ? 'Hide map' : 'Show map'; toggle.setAttribute('aria-expanded', String(visible)) }
    document.body.dataset['liveMinimapVisible'] = String(visible)
  }
}

export function keepFollowedInView(camera: { scrollX: number; scrollY: number; width: number; height: number; zoom: number;
  centerOn: (x: number, y: number) => unknown }, target: Point, acquired: boolean): boolean {
  const width = camera.width / camera.zoom; const height = camera.height / camera.zoom
  const view = { x: camera.scrollX + camera.width / 2 - width / 2,
    y: camera.scrollY + camera.height / 2 - height / 2, width, height }
  const next = followScroll(view, target, view, acquired)
  camera.centerOn(next.x + width / 2, next.y + height / 2)
  return next.acquired
}

function drawRooms(context: CanvasRenderingContext2D, rooms: readonly MiniRect[], color: string): void {
  context.strokeStyle = color; context.lineWidth = 1
  for (const room of rooms) {
    if (!room.outline) { context.strokeRect(room.x + 0.5, room.y + 0.5, Math.max(1, room.width - 1), Math.max(1, room.height - 1)); continue }
    context.beginPath()
    room.outline.forEach((point, index) => index ? context.lineTo(point.x + 0.5, point.y + 0.5) : context.moveTo(point.x + 0.5, point.y + 0.5))
    context.closePath(); context.stroke()
  }
}
