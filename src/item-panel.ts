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
  description: string | null | undefined
}>): readonly ItemPanelFact[] {
  const facts: ItemPanelFact[] = []
  if (Number.isSafeInteger(input.placeId) && input.placeId !== null && input.placeId > 0) {
    const placeName = input.placeName?.trim() || null
    facts.push(Object.freeze({ label: 'Where', value: placeName
      ? `${placeName} · place #${input.placeId}` : `place #${input.placeId}` }))
  }
  facts.push(Object.freeze({ label: 'State', value: input.asleep ? 'Asleep' : 'Awake' }))
  const description = input.description?.trim() || null
  if (description) facts.push(Object.freeze({ label: 'Description', value: description }))
  return Object.freeze(facts)
}

export function thingPanelFacts(input: Readonly<{
  kind: string | null | undefined
  owner: string | null | undefined
  description: string | null | undefined
}>): readonly ItemPanelFact[] {
  const facts: ItemPanelFact[] = []
  const kind = input.kind?.trim() || null
  const owner = input.owner?.trim() || null
  const description = input.description?.trim() || null
  if (kind) facts.push(Object.freeze({ label: 'Kind', value: kind }))
  if (owner) facts.push(Object.freeze({ label: 'Owner', value: owner }))
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
