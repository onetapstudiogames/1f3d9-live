import type { ActivityState } from './activity.ts'
import type { ActivityCueState } from './activity-cues.ts'
import type { LookingState } from './looking.ts'

export type ActiveLookSnapshot = Readonly<{ residentId: number; key: string; expiresAt: number }>
export type RecentActivitySnapshot = Readonly<{ key: string; startedAt: number }>

export type ActivitySnapshot = Readonly<{
  log: ActivityState
  cues: ActivityCueState
  looking?: LookingState
  activeLooks?: readonly ActiveLookSnapshot[]
  recent?: readonly (readonly [number, RecentActivitySnapshot])[]
  activeResidents?: readonly number[]
  capturedWallNow?: number
}>

export function visibleLookingIds(active: readonly ActiveLookSnapshot[], wallNow: number): ReadonlySet<number> {
  return new Set(active.filter(row => row.expiresAt > wallNow).map(row => row.residentId))
}

export function rebaseActiveLooks(active: readonly ActiveLookSnapshot[], capturedWallNow: number,
  resumeWallNow: number): readonly ActiveLookSnapshot[] {
  const shift = resumeWallNow - capturedWallNow
  return Object.freeze(active.map(row => Object.freeze({ ...row, expiresAt: row.expiresAt + shift })))
}
