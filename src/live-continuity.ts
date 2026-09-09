import type { ReplayEvent } from './city/types.ts'

export const LIVE_CADENCE_MS = 30_000
export type LiveReturnReason = 'visibility' | 'gap'
type Signal = Readonly<{ kind: 'visibility'; wasHidden: boolean; hidden: boolean }
  | { kind: 'frame'; lastFrameAt: number | null; now: number }>

/** Unobserved intervals never become a queue to replay when the picture returns. */
export function liveReturnReason(signal: Signal): LiveReturnReason | null {
  if (signal.kind === 'visibility') return signal.wasHidden && !signal.hidden ? 'visibility' : null
  return signal.lastFrameAt !== null && Number.isFinite(signal.now) && Number.isFinite(signal.lastFrameAt)
    && signal.now - signal.lastFrameAt > LIVE_CADENCE_MS ? 'gap' : null
}

type ReturnState = Readonly<{ returnReason: LiveReturnReason | null; liveQueue: readonly ReplayEvent[];
  pollGeneration: number; polling: boolean }>

export function beginCurrentReturn(previous: ReturnState, reason: LiveReturnReason, hidden: boolean): Readonly<{
  state: ReturnState; readNow: boolean
}> {
  return Object.freeze({ readNow: !hidden, state: Object.freeze({
    returnReason: previous.returnReason ?? reason,
    liveQueue: Object.freeze([]), pollGeneration: previous.pollGeneration + 1, polling: false,
  }) })
}
