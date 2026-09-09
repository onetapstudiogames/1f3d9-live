import type { NestedLayout } from './ground/nested.ts'

export type PlaceAnimation = Readonly<{
  placeId: number
  kind: 'founding' | 'renaming'
  startedAt: number
  duration: number
  changeId: string
}>
export function placeAnimation(
  kind: PlaceAnimation['kind'], placeId: number, changeId: string, now: number,
): PlaceAnimation {
  const duration = kind === 'founding' ? 3_200 : 700
  return { placeId, kind, changeId, startedAt: Number.isFinite(now) ? now : 0, duration }
}

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function animationProgress(animation: PlaceAnimation, now: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(animation.duration) || animation.duration <= 0) return 0
  return unit((now - animation.startedAt) / animation.duration)
}

export function stepPlaceAnimations(
  active: readonly PlaceAnimation[], incoming: readonly PlaceAnimation[], now: number,
): readonly PlaceAnimation[] {
  const kept = active.filter(animation => animationProgress(animation, now) < 1)
  const seen = new Set(kept.map(animation => animation.changeId))
  const result = [...kept]
  for (const animation of incoming) if (!seen.has(animation.changeId)) {
    seen.add(animation.changeId)
    const founding = animation.kind === 'renaming'
      ? [...result, ...incoming].find(candidate => candidate.placeId === animation.placeId && candidate.kind === 'founding')
      : undefined
    result.push(founding
      ? { ...animation, startedAt: Math.max(animation.startedAt, founding.startedAt + founding.duration) }
      : animation)
  }
  return result
}

export function contentHiddenRooms(
  layout: NestedLayout, active: readonly PlaceAnimation[],
): ReadonlySet<number> {
  const result = new Set<number>()
  const visit = (id: number): void => {
    if (result.has(id)) return
    result.add(id)
    for (const child of layout.rooms[id]?.children ?? []) visit(child)
  }
  for (const animation of active) if (animation.kind === 'founding') visit(animation.placeId)
  return result
}

