import type { ReplayFile, Resident } from '../../src/city/types.ts'
import { nestedLayout } from '../../src/ground/nested.ts'
import { appliedMove } from '../../src/replay/index.ts'
import { createResidents, stepResidents } from '../../src/replay/simulation.ts'
import { presentRoom } from '../../src/room-presentation.ts'
import { singleRoomLayout } from '../../src/room-view.ts'
import { RoomMotion } from '../../src/scenes/RoomMotion.ts'
import { advanceSceneClock, createSceneClock, dueSceneEvents, prepareSceneTimeline } from './recorded-scene.ts'

// A focused scene uses an unchanged saved move and its recorded source. Only its
// actor is staged, so these frames test presentation rather than claim a census.
export function recordedRoomFrames(replay: ReplayFile, census: readonly Resident[], changeId: string): string {
  const event = replay.timeline.find(row => row.change_id === changeId)
  const move = event && appliedMove(event)
  const actor = census.find(row => row.handle === event?.actor)
  if (!event || !move || !actor) throw new Error('The recorded room scene needs a saved move and its resident')
  const beginning = Date.parse(event.at) - 100
  const scene = { ...replay, window_start: new Date(beginning).toISOString(),
    window_end: new Date(beginning + 8_000).toISOString(), timeline: [event],
    start: { [`resident:${actor.id}`]: { place_id: move.fromId } } }
  const layout = nestedLayout(scene.map.places, { [move.fromId]: 1, [move.toId]: 1 })
  const viewport = { width: 500, height: 380 }
  const motion = new RoomMotion()
  let state = createResidents(scene, [actor], layout)
  let roomId = move.fromId
  let clock = createSceneClock(scene.window_start, scene.window_end)
  let cursor = 0
  let crowding: Parameters<typeof presentRoom>[5]
  const timeline = prepareSceneTimeline(scene.timeline)
  const frames: unknown[] = []
  const render = () => {
    motion.configure(layout, {}, viewport, roomId, actor.id, new Set(), new Set())
    const display = singleRoomLayout(layout.rooms[roomId]!, viewport.width, viewport.height)
    const hidden = new Set(Object.keys(layout.rooms).map(Number).filter(id => id !== roomId))
    const frame = presentRoom(state.residents, {}, layout, display, hidden, crowding,
      actor.id, new Map(), motion.presentation(roomId))
    crowding = frame.crowding
    motion.remember(frame.residents, frame.things)
    return frame
  }
  render()
  for (let elapsed = 0; elapsed <= 8_000; elapsed += 100) {
    const due = dueSceneEvents(timeline, cursor, clock.time)
    cursor = due.cursor
    state = stepResidents(state, due.events, elapsed === 0 ? 0 : 100, elapsed, layout, new Map(), undefined, {
      startMove: (resident, row, all) => motion.start(resident, row, all),
      advanceMove: (resident, delta) => motion.advance(resident, delta),
    })
    const resident = state.residents[actor.id]!
    if (resident.placeId !== null && resident.placeId !== roomId) { roomId = resident.placeId; crowding = undefined }
    const frame = render()
    if (elapsed % 500 === 0 || due.events.length) frames.push({ elapsed, roomId,
      delivered: cursor, resident: frame.residents[actor.id], placements: frame.placements })
    clock = advanceSceneClock(clock, 100)
  }
  return `${JSON.stringify(frames, null, 2)}\n`
}
