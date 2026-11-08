import { publicActivity } from './public-activity.ts'
import { endingTime, type ThingEnding } from './city/thing-ending.ts'

export type ItemPanelFact = Readonly<{ label: string; value: string }>
export type ItemPanelRect = Readonly<{ left: number; top: number; right: number; bottom: number }>
export type ItemPanelSize = Readonly<{ width: number; height: number }>
export type ItemPanelPlacement = Readonly<{ left: number; top: number; side: 'right' | 'left' | 'sheet' }>

const PANEL_MARGIN = 8
const PANEL_GAP = 10
const PHONE_WIDTH = 600

export function residentPanelFacts(input: Readonly<{
  placeId: number | null
  placeName: string | null | undefined
  asleep: boolean
  lastActive?: unknown
  description: string | null | undefined
}>): readonly ItemPanelFact[] {
  const facts: ItemPanelFact[] = []
  if (Number.isSafeInteger(input.placeId) && input.placeId !== null && input.placeId > 0) {
    const placeName = input.placeName?.trim() || null
    facts.push(Object.freeze({ label: 'Where', value: placeName
      ? `${placeName} · place #${input.placeId}` : `place #${input.placeId}` }))
  }
  const state = input.asleep ? 'Asleep' : 'Awake'
  const activity = publicActivity(input.lastActive)
  facts.push(Object.freeze({ label: 'State', value: activity ? `${state} · ${activity}` : state }))
  const description = input.description?.trim() || null
  if (description) facts.push(Object.freeze({ label: 'Description', value: description }))
  return Object.freeze(facts)
}

export type EndTimeFormat = (iso: string) => string

/** The viewer's local date and time, as the city window shows an end. */
export function localEndTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

/**
 * The thing read's ending as panel facts, following the city window's thing view: "Ends" with each
 * condition the read computed, joined by "or" (the first to come ends it), followed by the
 * city's own end program sentence; or "Ended" with the recorded end, or the due time while
 * the end has come and is not yet written down. Nothing when no end is set.
 */
export function thingEndingFacts(ending: ThingEnding | null | undefined, summary: string | null | undefined,
  formatTime: EndTimeFormat = localEndTime): readonly ItemPanelFact[] {
  if (!ending) return Object.freeze([])
  const when = (value: unknown): string | null => {
    const iso = endingTime(value)
    return iso ? formatTime(iso) : null
  }
  if (ending.status === 'ended' || ending.status === 'due_waiting_settle') {
    const at = when(ending.endedAt) ?? when(ending.soonestKnownEnd)
    return Object.freeze([Object.freeze({ label: 'Ended', value: at ? `on ${at}; it is a remnant now` : 'it is a remnant now' })])
  }
  if (ending.status !== 'active') return Object.freeze([])
  const parts = ending.conditions.flatMap(condition => {
    if (Object.hasOwn(condition, 'at')) { const at = when(condition['at']); return at ? [`on ${at}`] : [] }
    if (Object.hasOwn(condition, 'after_setting_seconds')) { const at = when(condition['ends_at']); return at ? [`on ${at}`] : [] }
    if (Object.hasOwn(condition, 'uses')) {
      const left = condition['uses_left']
      return Number.isSafeInteger(left) && (left as number) >= 0
        ? [`after ${String(left)} more ${left === 1 ? 'use' : 'uses'}`] : []
    }
    if (Object.hasOwn(condition, 'idle_seconds')) {
      const at = when(condition['unused_deadline']); return at ? [`if unused until ${at}`] : []
    }
    if (Object.hasOwn(condition, 'label_added')) {
      const label = typeof condition['label_added'] === 'string' ? condition['label_added'].trim() : ''
      return label ? [`when labeled ${label}`] : []
    }
    return []
  })
  const facts: ItemPanelFact[] = [Object.freeze({ label: 'Ends', value: parts.length ? parts.join(' or ') : 'an end is set' })]
  const sentence = summary?.trim()
  if (sentence) facts.push(Object.freeze({ label: 'When it ends', value: sentence }))
  return Object.freeze(facts)
}

export function thingPanelFacts(input: Readonly<{
  kind: string | null | undefined
  owner: string | null | undefined
  description: string | null | undefined
  ending?: ThingEnding | null | undefined
  endProgramSummary?: string | null | undefined
  formatTime?: EndTimeFormat
}>): readonly ItemPanelFact[] {
  const facts: ItemPanelFact[] = []
  const kind = input.kind?.trim() || null
  const owner = input.owner?.trim() || null
  const description = input.description?.trim() || null
  if (kind) facts.push(Object.freeze({ label: 'Kind', value: kind }))
  if (owner) facts.push(Object.freeze({ label: 'Owner', value: owner }))
  facts.push(...thingEndingFacts(input.ending, input.endProgramSummary, input.formatTime))
  if (description) facts.push(Object.freeze({ label: 'Description', value: description }))
  return Object.freeze(facts)
}

export function itemPanelPlacement(
  anchor: ItemPanelRect,
  size: ItemPanelSize,
  viewport: ItemPanelRect,
): ItemPanelPlacement | null {
  const values = [anchor.left, anchor.top, anchor.right, anchor.bottom, size.width, size.height,
    viewport.left, viewport.top, viewport.right, viewport.bottom]
  if (!values.every(Number.isFinite) || anchor.right <= anchor.left || anchor.bottom <= anchor.top
    || size.width <= 0 || size.height <= 0 || viewport.right <= viewport.left || viewport.bottom <= viewport.top) return null

  const viewportWidth = viewport.right - viewport.left
  const minLeft = viewport.left + PANEL_MARGIN
  const maxLeft = viewport.right - PANEL_MARGIN - size.width
  const minTop = viewport.top + PANEL_MARGIN
  const maxTop = viewport.bottom - PANEL_MARGIN - size.height
  if (maxLeft < minLeft || maxTop < minTop) return null

  if (viewportWidth <= PHONE_WIDTH) {
    return Object.freeze({ left: PANEL_MARGIN, top: maxTop - viewport.top, side: 'sheet' })
  }

  const roomOnRight = viewport.right - PANEL_MARGIN - (anchor.right + PANEL_GAP)
  const roomOnLeft = anchor.left - PANEL_GAP - (viewport.left + PANEL_MARGIN)
  const side: ItemPanelPlacement['side'] = roomOnRight >= size.width ? 'right'
    : roomOnLeft >= size.width ? 'left'
      : roomOnRight >= roomOnLeft ? 'right' : 'left'
  const preferredLeft = side === 'right' ? anchor.right + PANEL_GAP : anchor.left - PANEL_GAP - size.width
  const centerTop = (anchor.top + anchor.bottom - size.height) / 2
  const left = Math.max(minLeft, Math.min(preferredLeft, maxLeft))
  const top = Math.max(minTop, Math.min(centerTop, maxTop))
  return Object.freeze({ left: left - viewport.left, top: top - viewport.top, side })
}
