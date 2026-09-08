import type { ActivityCue } from './activity.ts'

export type CueEntry = Readonly<{ key: string; cue: ActivityCue; startedAt: number; expiresAt?: number;
  residentId: number | null; thingId: number | null; roomId: number | null; x?: number; y?: number }>
export type ActivityCueState = Readonly<{ active: readonly CueEntry[]; seenKeys: readonly string[] }>
export type CueFrame = Readonly<{ key: string; cue: ActivityCue; residentId: number | null; thingId: number | null;
  roomId: number | null; anchor: Readonly<{ x: number; y: number; roomId: number | null }> | null;
  cells: readonly (readonly [number, number])[]; alpha: number }>

const CUE_MS = 3_000
const motif = (rows: readonly string[]): readonly (readonly [number, number])[] => Object.freeze(rows.flatMap((row, y) =>
  [...row].flatMap((cell, x) => cell === '#' ? [[x, y] as const] : [])))
const MOTIFS: Readonly<Partial<Record<ActivityCue, readonly (readonly [number, number])[]>>> = Object.freeze({
  note: motif(['.####.', '#....#', '######', '#.....', '.#####']),
  home: motif(['..#..', '.###.', '#...#', '#.#.#', '#####']),
  rules: motif(['#####', '#.#..', '#####', '..#.#', '#####']),
  wait: motif(['#####', '.###.', '..#..', '.###.', '#####']),
  failed: motif(['#...#', '.#.#.', '..#..', '.....', '..#..']),
  change: motif(['..#..', '#.#.#', '.###.', '#.#.#', '..#..']),
  trade: motif(['.###..', '#....#', '######', '#....#', '..###.']),
  use: motif(['#.#.#', '.###.', '#####', '.###.', '#.#.#']),
  consume: motif(['#.#.#', '.#.#.', '..#..', '.....', '..#..']),
  make: motif(['..#..', '.###.', '#####', '.###.', '..#..']),
  agreement: motif(['##.##', '#.#.#', '.###.', '#.#.#', '##.##']),
  departure: motif(['...#.', '..#..', '#####', '..#..', '...#.']),
  arrival: motif(['.#...', '..#..', '#####', '..#..', '.#...']),
  looking: motif(['..####..', '.#....#.', '#..##..#', '.#....#.', '..####..']),
})
const DOT = motif(['##', '##'])
export const emptyCueState = (): ActivityCueState => Object.freeze({ active: Object.freeze([]), seenKeys: Object.freeze([]) })
const endOf = (entry: CueEntry): number => Math.min(entry.startedAt + CUE_MS, entry.expiresAt ?? Number.POSITIVE_INFINITY)

export function stepActivityCues(previous: ActivityCueState, additions: readonly CueEntry[], now: number,
  representedKeys: ReadonlySet<string> = new Set()): ActivityCueState {
  if (!Number.isFinite(now)) throw new TypeError('cue time must be finite')
  const seen = new Set(previous.seenKeys); const active = previous.active.filter(entry => endOf(entry) > now)
  for (const entry of additions) {
    if (!entry.key || seen.has(entry.key)) continue
    seen.add(entry.key)
    if (!representedKeys.has(entry.key) && Number.isFinite(entry.startedAt) && endOf(entry) > now) active.push(Object.freeze({ ...entry }))
  }
  return Object.freeze({ active: Object.freeze(active), seenKeys: Object.freeze([...seen].slice(-1_000)) })
}

export function cueFrame(state: ActivityCueState, now: number): readonly CueFrame[] {
  return Object.freeze(state.active.filter(entry => entry.startedAt <= now && endOf(entry) > now).map(entry => {
    const progress = Math.max(0, Math.min(1, (now - entry.startedAt) / Math.max(1, endOf(entry) - entry.startedAt)))
    return Object.freeze({ key: entry.key, cue: entry.cue, residentId: entry.residentId, thingId: entry.thingId, roomId: entry.roomId,
      anchor: Number.isFinite(entry.x) && Number.isFinite(entry.y) ? Object.freeze({ x: entry.x!, y: entry.y!, roomId: entry.roomId }) : null,
      cells: MOTIFS[entry.cue] ?? DOT,
      alpha: Math.max(0, Math.min(1, 1 - Math.max(0, progress - 0.7) / 0.3)) })
  }))
}
