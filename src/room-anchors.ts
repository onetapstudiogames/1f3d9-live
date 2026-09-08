import type { CueFrame } from './activity-cues.ts'
import { floatFrame } from './giving.ts'
import type { HandoverState, HandoverStep } from './handovers.ts'
import type { NestedLayout, Room } from './ground/nested.ts'
import type { ResidentState } from './replay/simulation.ts'
import { projectRoomPoint, roomIsPublic } from './room-view.ts'

export function roomAnchorPair(sourceLayout: NestedLayout | undefined, displayLayout: NestedLayout | undefined,
  selectedId: number | null): Readonly<{ source: Room; target: Room }> | undefined {
  if (!sourceLayout || !displayLayout || selectedId === null || !Number.isSafeInteger(selectedId)) return undefined
  const source = sourceLayout.rooms[selectedId]; const target = displayLayout.rooms[selectedId]
  if (!source || !target || source.id !== selectedId || target.id !== selectedId ||
      !roomIsPublic(sourceLayout, selectedId) || !roomIsPublic(displayLayout, selectedId)) return undefined
  return Object.freeze({ source, target })
}

export function projectCueAnchors(frames: readonly CueFrame[], source: Room, target: Room): readonly CueFrame[] {
  return Object.freeze(frames.map(frame => {
    if (!frame.anchor || frame.anchor.roomId !== source.id) return frame
    const point = projectRoomPoint(frame.anchor, source, target)
    return Object.freeze({ ...frame, anchor: point ? Object.freeze({ ...point, roomId: target.id }) : null })
  }))
}

type VisibleFigure = Readonly<{ x: number; y: number; visible: boolean }>

export function visibleFigureMidpoint(left: VisibleFigure | undefined, right: VisibleFigure | undefined): Readonly<{ x: number; y: number }> | null {
  if (!left?.visible || !right?.visible || ![left.x, left.y, right.x, right.y].every(Number.isFinite)) return null
  return Object.freeze({ x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 })
}

export function projectRoomHandovers(
  frame: HandoverStep,
  state: HandoverState,
  residents: Readonly<Record<number, ResidentState>>,
  nowMs: number,
): HandoverStep {
  const motions = frame.motions.flatMap(motion => {
    if (motion.key.startsWith('carry:')) {
      const noticeId = motion.key.slice('carry:'.length)
      const carry = state.held.find(item => item.plan.noticeChangeId === noticeId)?.plan
      const carrier = carry ? residents[carry.carrierId] : undefined
      return carrier?.visible ? [Object.freeze({ ...motion, x: carrier.x, y: carrier.y - 12, visible: true })] : []
    }
    if (!motion.key.startsWith('transfer:')) return motion.visible ? [motion] : []
    const changeId = motion.key.slice('transfer:'.length)
    const active = state.floats.find(item => item.changeId === changeId) ?? frame.state.floats.find(item => item.changeId === changeId)
    if (!active) return []
    const from = Object.values(residents).find(resident => resident.handle.trim() === active.transfer.actor)
    const to = residents[active.transfer.partnerId]
    if (!eligibleTransferFigure(from, active.transfer.placeId) || !eligibleTransferFigure(to, active.transfer.placeId)) return []
    const floated = floatFrame(from, to, active.startedAt, nowMs, active.speed)
    if (!floated) return []
    const next = { ...motion, x: floated.x, y: floated.y, visible: true, alpha: floated.alpha }
    return [Object.freeze(active.transfer.mode === 'gift'
      ? { ...next, heart: Object.freeze({ x: floated.heartX, y: floated.heartY }) }
      : withoutHeart(next))]
  })
  return Object.freeze({ ...frame, motions: Object.freeze(motions) })
}

function eligibleTransferFigure(resident: ResidentState | undefined, placeId: number): resident is ResidentState {
  return resident !== undefined && resident.visible && !resident.walking && resident.placeId === placeId &&
    Number.isFinite(resident.x) && Number.isFinite(resident.y)
}

function withoutHeart<T extends { heart?: unknown }>(value: T): Omit<T, 'heart'> {
  const { heart: _heart, ...plain } = value
  return plain
}
