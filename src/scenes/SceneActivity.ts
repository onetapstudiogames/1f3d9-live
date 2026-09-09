import type Phaser from 'phaser'
import type { ActivityContext, ActivityEntry } from '../activity.ts'
import { cueFrame, emptyCueState, stepActivityCues, type CueEntry } from '../activity-cues.ts'
import type { ReplayEvent, Resident } from '../city/types.ts'
import type { NestedLayout } from '../ground/nested.ts'
import { stepLookingPresence, type LookingState } from '../looking.ts'
import type { ResidentState } from '../replay/simulation.ts'
import type { ThingState } from '../things.ts'
import { ActivityLayer } from './ActivityLayer.ts'
import { activityEntriesFromRows, type RoomActivityLine } from './RoomActivityLine.ts'
import { projectCueAnchors } from '../room-anchors.ts'

export class SceneActivity {
  private readonly layer: ActivityLayer
  private readonly log: RoomActivityLine
  private readonly context: ActivityContext
  private cues = emptyCueState()
  private looking: LookingState | undefined
  private activeLooks: readonly Readonly<{ residentId: number; key: string; expiresAt: number }>[] = []

  constructor(scene: Phaser.Scene,
    log: RoomActivityLine,
    context: ActivityContext) {
    this.layer = new ActivityLayer(scene)
    this.log = log
    this.context = context
  }

  reset(): void {
    this.log.clearHistory(); this.cues = emptyCueState(); this.looking = undefined; this.activeLooks = []
  }

  animate(rows: readonly ReplayEvent[], recordedNow: number, presentationNow: number,
    representedKeys: ReadonlySet<string> = new Set()): readonly ActivityEntry[] {
    const derived = activityEntriesFromRows(rows, recordedNow, this.context)
    const entries = derived.map(entry => this.toCue(entry, presentationNow))
    this.cues = stepActivityCues(this.cues, entries, presentationNow, representedKeys)
    return derived
  }

  witness(rows: readonly ReplayEvent[], observedAt: number, context: ActivityContext = this.context): readonly ActivityEntry[] {
    return this.log.witness(rows, observedAt, context)
  }

  resetPresentation(): void {
    this.cues = emptyCueState()
    this.looking = undefined
    this.activeLooks = []
  }

  observeLooking(census: readonly Resident[], wallNow: number, playingLive: boolean,
    recordedResidences: ReadonlyMap<number, number>, quietRooms: ReadonlySet<number>, presentationNow: number): readonly ActivityEntry[] {
    const stepped = stepLookingPresence(this.looking, { residents: census, wallNow, playingLive,
      recordedPlaceByResident: recordedResidences, quietPlaceIds: quietRooms })
    this.looking = stepped.state
    this.activeLooks = stepped.active.map(row => ({ residentId: row.residentId, key: row.key, expiresAt: row.expiresAt }))
    const entries = stepped.moments.flatMap(moment => {
      const resident = this.context.residentById?.(moment.residentId); const place = this.context.place(moment.roomId)
      if (!resident || !place) return []
      const placeEntity = Object.freeze({ type: 'place' as const, id: place.id, name: place.name, hasDrawing: place.hasDrawing })
      return [Object.freeze({ key: moment.key, changeId: 0, time: wallNow, kind: 'event' as const,
        text: `${moment.name} is looking around.`, entities: Object.freeze([resident, placeEntity]), cue: 'looking' as const,
        roomId: moment.roomId, anchorRoomId: moment.roomId, actorResidentId: moment.residentId })]
    })
    const added = this.log.appendEntries(entries)
    const cueEntries = stepped.moments.map(moment => this.toCue({ key: moment.key, changeId: 0, time: wallNow, kind: 'event',
      text: '', entities: [], cue: 'looking', roomId: moment.roomId, actorResidentId: moment.residentId }, presentationNow,
    presentationNow + Math.min(3_000, moment.expiresAt - wallNow)))
    this.cues = stepActivityCues(this.cues, cueEntries, presentationNow)
    return added
  }

  update(residents: Readonly<Record<number, ResidentState>>, things: Readonly<Record<number, ThingState>>, layout: NestedLayout,
    hidden: ReadonlySet<number>, now: number, zoom: number, wallNow?: number,
    anchorRooms?: Readonly<{ source: NestedLayout['rooms'][number]; target: NestedLayout['rooms'][number] }>): void {
    if (Number.isFinite(wallNow)) {
      const expired = new Set(this.activeLooks.filter(row => row.expiresAt <= wallNow!).map(row => row.key))
      this.activeLooks = this.activeLooks.filter(row => row.expiresAt > wallNow!)
      if (expired.size) this.cues = Object.freeze({ ...this.cues,
        active: Object.freeze(this.cues.active.filter(cue => !expired.has(cue.key))) })
    }
    this.cues = stepActivityCues(this.cues, [], now)
    const rawFrames = cueFrame(this.cues, now)
    const frames = anchorRooms ? projectCueAnchors(rawFrames, anchorRooms.source, anchorRooms.target) : rawFrames
    this.layer.update(frames, Object.values(residents), Object.values(things), layout, hidden, zoom)
  }

  destroy(): void { this.layer.destroy() }

  private toCue(entry: ActivityEntry, startedAt: number, expiresAt?: number): CueEntry {
    return Object.freeze({ key: entry.key, cue: entry.cue ?? 'action', startedAt, expiresAt,
      residentId: entry.actorResidentId ?? null, thingId: entry.thingId ?? null,
      roomId: entry.anchorRoomId ?? entry.roomId ?? null })
  }
}
