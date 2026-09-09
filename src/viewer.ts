import type { Point } from './ground/nested.ts'

export type ViewerCamera = Readonly<{ scrollX: number; scrollY: number; width: number; height: number; zoom: number }>
export type FollowState = Readonly<{ residentId: number | null; suspended: boolean; activityId: string | null }>
export type FocusTarget = Readonly<Point & { key: string; roomId: number; rank: number; startedAt: number }>

export function cameraFrame(camera: ViewerCamera): Readonly<Point & { width: number; height: number }> {
  const width = camera.width / camera.zoom; const height = camera.height / camera.zoom
  return Object.freeze({ x: camera.scrollX + camera.width / 2 - width / 2,
    y: camera.scrollY + camera.height / 2 - height / 2, width, height })
}

export function zoomAt(camera: ViewerCamera, requested: number, anchor: Point): Readonly<Point & { zoom: number }> {
  const zoom = Number.isFinite(requested) ? Math.min(3, Math.max(0.005, requested)) : camera.zoom
  const view = cameraFrame(camera)
  return Object.freeze({ zoom, x: view.x + anchor.x / camera.zoom + (camera.width / 2 - anchor.x) / zoom,
    y: view.y + anchor.y / camera.zoom + (camera.height / 2 - anchor.y) / zoom })
}

export function followActivity(state: FollowState, residentId: number, activityId: string | null): FollowState {
  if (state.residentId !== residentId || !activityId || activityId === state.activityId) return state
  return Object.freeze({ residentId, suspended: false, activityId })
}

export function focusTarget(candidates: readonly FocusTarget[]): FocusTarget | null {
  return [...candidates].filter(row => Number.isFinite(row.x) && Number.isFinite(row.y))
    .sort((a, b) => b.rank - a.rank || b.startedAt - a.startedAt || a.key.localeCompare(b.key))[0] ?? null
}

export function reappearanceAlpha(relocatedAt: number | undefined, now: number): number {
  return relocatedAt === undefined ? 1 : Math.min(1, Math.max(0, (now - relocatedAt) / 400))
}
