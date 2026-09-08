import type Phaser from 'phaser'
import type { ActivityContext, ActivityEntry } from '../activity.ts'
import { cueFrame, emptyCueState, stepActivityCues, type CueEntry } from '../activity-cues.ts'
import type { ReplayEvent, Resident } from '../city/types.ts'
import type { NestedLayout } from '../ground/nested.ts'
import { stepLookingPresence, type LookingState } from '../looking.ts'
import type { ResidentState } from '../replay/simulation.ts'
import type { ThingState } from '../things.ts'
import { ActivityLayer } from './ActivityLayer.ts'
import type { ActivityLog } from './ActivityLog.ts'
import { rebaseActiveLooks, visibleLookingIds, type ActivitySnapshot } from '../activity-snapshot.ts'
import { projectCueAnchors } from '../room-anchors.ts'

export type { ActivitySnapshot } from '../activity-snapshot.ts'
export type HistoricalAnchor = Readonly<{ x: number; y: number; roomId: number }>
export type ActivityAnchorResolver = (entry: ActivityEntry) => HistoricalAnchor | null

export class SceneActivity {
  private readonly layer: ActivityLayer
  private cues = emptyCueState()
  private looking: LookingState | undefined
  private activeLooks: readonly Readonly<{ residentId: number; key: string; expiresAt: number }>[] = []
  private readonly recent = new Map<number, Readonly<{ key: string; startedAt: number }>>()
  private activeResidents: readonly number[] = []
  private restoredWallNow: number | undefined

  constructor(scene: Phaser.Scene,
    private readonly log: Pick<ActivityLog, 'append' | 'appendEntries' | 'reset' | 'snapshot' | 'restore'>,
    private readonly context: ActivityContext) {
    this.layer = new ActivityLayer(scene)
  }

  reset(rows: readonly ReplayEvent[] = [], recordedNow = Number.NEGATIVE_INFINITY): void {
    this.log.reset(rows, recordedNow); this.cues = emptyCueState(); this.looking = undefined; this.activeLooks = []; this.recent.clear(); this.activeResidents = []; this.restoredWallNow = undefined
  }

  consume(rows: readonly ReplayEvent[], recordedNow: number, presentationNow: number,
    representedKeys: ReadonlySet<string> = new Set(), anchor: ActivityAnchorResolver = () => null): readonly ActivityEntry[] {
    const added = this.log.append(rows, recordedNow)
    const entries = added.map(entry => this.toCue(entry, presentationNow, anchor(entry)))
    this.cues = stepActivityCues(this.cues, entries, presentationNow, representedKeys)
    for (const entry of added) if (entry.actorResidentId) this.recent.set(entry.actorResidentId, { key: entry.key, startedAt: presentationNow })
    return added
  }

  observeLooking(census: readonly Resident[], wallNow: number, playingLive: boolean,
    recordedResidences: ReadonlyMap<number, number>, quietRooms: ReadonlySet<number>, presentationNow: number): readonly ActivityEntry[] {
    this.restoredWallNow = undefined
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
      text: '', entities: [], cue: 'looking', roomId: moment.roomId, actorResidentId: moment.residentId }, presentationNow, null,
    presentationNow + Math.min(3_000, moment.expiresAt - wallNow)))
    this.cues = stepActivityCues(this.cues, cueEntries, presentationNow)
    for (const entry of added) if (entry.actorResidentId) this.recent.set(entry.actorResidentId, { key: entry.key, startedAt: presentationNow })
    return added
  }

  update(residents: Readonly<Record<number, ResidentState>>, things: Readonly<Record<number, ThingState>>, layout: NestedLayout,
    hidden: ReadonlySet<number>, now: number, zoom: number, wallNow?: number,
    anchorRooms?: Readonly<{ source: NestedLayout['rooms'][number]; target: NestedLayout['rooms'][number] }>): void {
    if (Number.isFinite(wallNow)) {
      this.restoredWallNow = undefined
      const expired = new Set(this.activeLooks.filter(row => row.expiresAt <= wallNow!).map(row => row.key))
      this.activeLooks = this.activeLooks.filter(row => row.expiresAt > wallNow!)
      if (expired.size) this.cues = Object.freeze({ ...this.cues,
        active: Object.freeze(this.cues.active.filter(cue => !expired.has(cue.key))) })
    }
    this.cues = stepActivityCues(this.cues, [], now)
    const rawFrames = cueFrame(this.cues, now)
    const frames = anchorRooms ? projectCueAnchors(rawFrames, anchorRooms.source, anchorRooms.target) : rawFrames
    this.activeResidents = Object.freeze([...new Set(frames.flatMap(frame => frame.residentId === null ? [] : [frame.residentId]))])
    this.layer.update(frames, Object.values(residents), Object.values(things), layout, hidden, zoom)
  }

  activeLookingIds(wallNow: number): ReadonlySet<number> {
    return visibleLookingIds(this.activeLooks, this.restoredWallNow ?? wallNow)
  }
  latestActivity(residentId: number): Readonly<{ key: string; startedAt: number }> | null { return this.recent.get(residentId) ?? null }
  focusCandidates(): readonly number[] { return this.activeResidents }
  snapshot(wallNow = Date.now()): ActivitySnapshot {
    return Object.freeze({ log: this.log.snapshot(), cues: this.cues, looking: this.looking,
      activeLooks: Object.freeze([...this.activeLooks]), recent: Object.freeze([...this.recent.entries()]),
      activeResidents: Object.freeze([...this.activeResidents]), capturedWallNow: wallNow })
  }
  restore(snapshot: ActivitySnapshot): void {
    this.log.restore(snapshot.log); this.cues = snapshot.cues; this.looking = snapshot.looking
    this.activeLooks = snapshot.activeLooks ?? []; this.recent.clear()
    for (const [residentId, recent] of snapshot.recent ?? []) this.recent.set(residentId, recent)
    this.activeResidents = snapshot.activeResidents ?? []
    this.restoredWallNow = Number.isFinite(snapshot.capturedWallNow) ? snapshot.capturedWallNow : undefined
  }
  resume(wallNow: number): void {
    if (this.restoredWallNow === undefined || !Number.isFinite(wallNow)) return
    this.activeLooks = rebaseActiveLooks(this.activeLooks, this.restoredWallNow, wallNow)
    this.restoredWallNow = undefined
  }
  destroy(): void { this.layer.destroy() }

  private toCue(entry: ActivityEntry, startedAt: number, anchor: HistoricalAnchor | null, expiresAt?: number): CueEntry {
    return Object.freeze({ key: entry.key, cue: entry.cue ?? 'action', startedAt, expiresAt,
      residentId: entry.actorResidentId ?? null, thingId: entry.thingId ?? null,
      roomId: anchor?.roomId ?? entry.anchorRoomId ?? entry.roomId ?? null, x: anchor?.x, y: anchor?.y })
  }
}
