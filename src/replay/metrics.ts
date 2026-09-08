import type { ReplayFile, Resident } from '../city/types.ts'
import { nestedLayout } from '../ground/nested.ts'
import { createHandovers, stepHandovers } from '../handovers.ts'
import { placeAnimation, stepPlaceAnimations, type PlaceAnimation } from '../place-animation.ts'
import { advancePresentation } from '../playback.ts'
import { planPlaces } from '../places.ts'
import { createThings, stepThings } from '../things.ts'
import { createClock, dueEvents, prepareTimeline } from './index.ts'
import { createResidents, roomCapacity, stepResidents } from './simulation.ts'

export type ReplayMetrics = Readonly<{
  speed: number
  walkCount: number
  totalPath: number
  longestPath: number
  dayDurationMs: number
}>

const FRAME_MS = 100

// This is the CityScene update loop without drawing. It deliberately calls the same pure
// resident, thing, handover, place-animation, clock, and routing functions as the page.
export function measureReplay(replay: ReplayFile, census: readonly Resident[], speed: number): ReplayMetrics {
  const layout = nestedLayout(replay.map.places, roomCapacity(replay, census))
  const thingsStart = createThings(replay, layout)
  let residents = createResidents(replay, census, layout, thingsStart.reservations)
  let things = thingsStart
  let handovers = createHandovers(replay.timeline)
  let handoverFrame: ReturnType<typeof stepHandovers> | null = null
  let clock = createClock(replay.window_start, replay.window_end, speed)
  const timeline = prepareTimeline(replay.timeline)
  const placePlan = planPlaces(replay)
  let placeAnimations: readonly PlaceAnimation[] = [...placePlan.foundings.values()]
    .filter(event => event.time === clock.start)
    .map(event => placeAnimation('founding', event.placeId, event.changeId, 0, speed))
  let cursor = 0
  let elapsed = 0
  let totalPath = 0
  let longestPath = 0
  const walks = new Set<string>()

  for (let frame = 0; frame < 1_000_000; frame += 1) {
    const pending = residents.pending || things.pending || handoverFrame?.pending === true || placeAnimations.length > 0
    if (clock.time >= clock.end && !pending && cursor >= timeline.length) {
      return Object.freeze({ speed, walkCount: walks.size, totalPath: Math.round(totalPath), longestPath: Math.round(longestPath), dayDurationMs: elapsed })
    }
    elapsed += FRAME_MS
    clock = advancePresentation(clock, FRAME_MS, pending, timeline[cursor]?.time ?? null)
    const due = dueEvents(timeline, cursor, clock.time)
    cursor = due.cursor
    const incoming = due.events.flatMap(event => {
      const id = event.detail.place_id
      if (id === undefined) return []
      const founding = placePlan.foundings.get(id)
      const rename = placePlan.renamings.get(id)?.find(row => row.changeId === event.change_id)
      const kind = founding?.changeId === event.change_id ? 'founding' : rename ? 'renaming' : null
      return kind ? [placeAnimation(kind, id, event.change_id, elapsed, speed)] : []
    })
    placeAnimations = stepPlaceAnimations(placeAnimations, incoming, elapsed)
    residents = stepResidents(residents, due.events, FRAME_MS, elapsed, layout, speed)
    handoverFrame = stepHandovers(handovers, due.events, residents, layout, elapsed, speed)
    handovers = handoverFrame.state
    things = stepThings(things, handoverFrame.floorEvents, elapsed, speed)
    for (const resident of Object.values(residents.residents)) {
      if (!resident.walking || resident.walkEventId === null || walks.has(resident.walkEventId)) continue
      const distance = resident.path.slice(1).reduce((sum, point, index) =>
        sum + Math.hypot(point.x - resident.path[index]!.x, point.y - resident.path[index]!.y), 0)
      walks.add(resident.walkEventId)
      totalPath += distance
      longestPath = Math.max(longestPath, distance)
    }
  }
  throw new Error('Replay measurement did not settle within its bounded frame limit')
}
