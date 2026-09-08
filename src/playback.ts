import { advanceClock, type Clock } from './replay/index.ts'

export type Playback = Readonly<{ paused: boolean; speed: number; direction: 'forward' | 'backward' }>
export type PlaybackCommand = 'pause' | 'normal' | 'fast' | 'rewind'

export function initialPlayback(): Playback { return Object.freeze({ paused: true, speed: 1, direction: 'forward' }) }

export function playbackCommand(state: Playback, command: PlaybackCommand): Playback {
  if (command === 'pause') return Object.freeze({ ...state, paused: true })
  if (command === 'rewind') return Object.freeze({ ...state, paused: false, direction: 'backward' })
  return Object.freeze({ paused: false, speed: command === 'fast' ? 60 : 1, direction: 'forward' })
}

export function advancePresentation(clock: Clock, deltaMs: number, pending: boolean, nextAt: number | null): Clock {
  if (pending || !Number.isFinite(deltaMs) || deltaMs < 0) return clock
  const next = advanceClock(clock, deltaMs)
  return nextAt !== null && Number.isFinite(nextAt) && nextAt >= clock.time
    ? Object.freeze({ ...next, time: Math.min(next.time, nextAt) }) : next
}
