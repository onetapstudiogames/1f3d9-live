export type BubblePoint = Readonly<{ x: number; y: number }>
export type BubbleSize = Readonly<{ width: number; height: number }>
export type BubblePosition = Readonly<{ x: number; y: number; tailX: number; tailY: number; side: 'above' | 'below' }>

const VIEWPORT_GUTTER = 8
const ABOVE_GAP = 10
const BELOW_NAME_CLEARANCE = 24
const TAIL_INSET = 8

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum))

/** Places a fixed-size speech card near its speaker. The caller supplies a card that fits
 * the viewport; this helper only chooses and clamps its position and tail attachment. */
export function positionBubbleCard(speaker: BubblePoint, card: BubbleSize, viewport: BubbleSize,
  figureSize: number): BubblePosition {
  const halfFigure = Math.max(0, figureSize) / 2
  const x = clamp(speaker.x - card.width / 2, VIEWPORT_GUTTER,
    viewport.width - VIEWPORT_GUTTER - card.width)
  const aboveY = speaker.y - halfFigure - ABOVE_GAP - card.height
  const belowY = speaker.y + halfFigure + BELOW_NAME_CLEARANCE
  let y: number
  if (card.height > viewport.height - VIEWPORT_GUTTER * 2) y = belowY
  else if (aboveY >= VIEWPORT_GUTTER) y = aboveY
  else if (belowY + card.height <= viewport.height - VIEWPORT_GUTTER) y = belowY
  else y = VIEWPORT_GUTTER

  const cardMiddle = y + card.height / 2
  const side = speaker.y >= cardMiddle ? 'above' : 'below'
  const tailX = clamp(speaker.x, x + TAIL_INSET, x + card.width - TAIL_INSET)
  const tailY = side === 'above' ? y + card.height : y
  return Object.freeze({ x, y, tailX, tailY, side })
}
