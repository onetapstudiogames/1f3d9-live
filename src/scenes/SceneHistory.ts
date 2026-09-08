import { createTape, playbackCursor, recordFrame, seekFrame, truncateTape, type PresentationTape } from '../presentation-history.ts'
import type { Clock } from '../replay/index.ts'
import type { Simulation } from '../replay/simulation.ts'
import type { ThingSimulation } from '../things.ts'
import type { HandoverState, HandoverStep } from '../handovers.ts'
import type { InventionState } from '../inventions.ts'
import type { PlaceAnimation } from '../place-animation.ts'
import type { StartedHandshake } from '../agreements.ts'
import type { SceneActivity } from './SceneActivity.ts'

export type PresentationState = Readonly<{
  clock: Clock; residents: Simulation; things: ThingSimulation; handovers: HandoverState
  handoverFrame?: HandoverStep; inventions: InventionState; placeAnimations: readonly PlaceAnimation[]
  elapsed: number; cursor: number; mode: 'live' | 'replay'; liveDeliveredMarker: number
  sleepers: ReadonlySet<number>; agreements: readonly StartedHandshake[]
  activity?: ReturnType<SceneActivity['snapshot']>
}>

/** The scene records presentation state; seeking never reads or writes the city. */
export class SceneHistory {
  private tape: PresentationTape<PresentationState> = createTape()
  private position = 0
  private selected = false
  get canRewind(): boolean { return this.tape.startTime !== null && this.position > this.tape.startTime }
  get rewound(): boolean { return this.selected }

  record(frame: PresentationState, force = false): void {
    this.tape = recordFrame(this.tape, frame.elapsed, frame, { force })
    this.position = frame.elapsed
  }
  reset(frame: PresentationState): void { this.tape = createTape(); this.selected = false; this.record(frame, true) }
  rewind(deltaMs: number): PresentationState | null {
    const cursor = playbackCursor(this.tape, this.position, deltaMs, 'rewind')
    this.position = cursor.time; this.selected = true
    return seekFrame(this.tape, this.position)?.frame ?? null
  }
  resume(): void {
    if (!this.selected) return
    this.tape = truncateTape(this.tape, this.position)
    this.position = this.tape.endTime ?? 0; this.selected = false
  }
}
