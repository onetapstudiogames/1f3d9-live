import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import type { ReplayFile, Resident } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { createHandovers, stepHandovers } from '../src/handovers.ts'
import { followScroll } from '../src/minimap.ts'
import { advanceToPlaceMoment, placeAnimation, stepPlaceAnimations, type PlaceAnimation } from '../src/place-animation.ts'
import { planPlaces } from '../src/places.ts'
import { createClock, dueEvents, prepareTimeline } from '../src/replay/index.ts'
import { createResidents, roomCapacity, stepResidents } from '../src/replay/simulation.ts'
import { createThings, stepThings } from '../src/things.ts'

const replay = JSON.parse(readFileSync(new URL('./fixtures/replay-24h.json', import.meta.url), 'utf8')) as ReplayFile
const census = ['page1', 'page2'].flatMap(page =>
  (JSON.parse(readFileSync(new URL(`./fixtures/residents-presence-${page}.json`, import.meta.url), 'utf8')) as { residents: Resident[] }).residents)

test('follow keeps the actual longest-route walker on a phone after acquisition', () => {
  const layout = nestedLayout(replay.map.places, roomCapacity(replay, census))
  let things = createThings(replay, layout)
  let residents = createResidents(replay, census, layout, things.reservations)
  let handovers = createHandovers(replay.timeline)
  let handoverFrame: ReturnType<typeof stepHandovers> | null = null
  let clock = createClock(replay.window_start, replay.window_end, 120)
  const timeline = prepareTimeline(replay.timeline)
  const places = planPlaces(replay)
  const placeMoments = [...places.foundings.values(), ...[...places.renamings.values()].flat()]
    .map(event => event.time).sort((left, right) => left - right)
  let animations: readonly PlaceAnimation[] = [...places.foundings.values()]
    .filter(event => event.time === clock.start)
    .map(event => placeAnimation('founding', event.placeId, event.changeId, 0, 120))
  const view = { width: 375 / 0.65, height: 812 / 0.65 }
  let scroll: ReturnType<typeof followScroll> | null = null
  let cursor = 0
  let elapsed = 0
  let frames = 0

  for (; frames < 100_000; frames += 1) {
    const pending = residents.pending || things.pending || handoverFrame?.pending === true || animations.length > 0
    if (clock.time >= clock.end && !pending && cursor >= timeline.length) break
    elapsed += 100
    if (!pending) clock = advanceToPlaceMoment(clock, 100, placeMoments)
    const due = dueEvents(timeline, cursor, clock.time)
    cursor = due.cursor
    const incoming = due.events.flatMap(event => {
      const id = event.detail.place_id
      if (id === undefined) return []
      const founding = places.foundings.get(id)
      const rename = places.renamings.get(id)?.find(row => row.changeId === event.change_id)
      const kind = founding?.changeId === event.change_id ? 'founding' : rename ? 'renaming' : null
      return kind ? [placeAnimation(kind, id, event.change_id, elapsed, 120)] : []
    })
    animations = stepPlaceAnimations(animations, incoming, elapsed)
    residents = stepResidents(residents, due.events, 100, elapsed, layout, 120)
    handoverFrame = stepHandovers(handovers, due.events, residents, layout, elapsed, 120)
    handovers = handoverFrame.state
    things = stepThings(things, handoverFrame.floorEvents, elapsed, 120)

    const walker = Object.values(residents.residents).find(resident => resident.walkEventId === '98186')
    if (!walker) continue
    scroll ??= followScroll({ x: walker.x - view.width / 2, y: walker.y - view.height / 2 }, walker, view, false)
    scroll = followScroll(scroll, walker, view, scroll.acquired)
    if (!scroll.acquired) continue
    assert.ok(walker.x >= scroll.x && walker.x <= scroll.x + view.width)
    assert.ok(walker.y >= scroll.y && walker.y <= scroll.y + view.height)
  }

  assert.ok(scroll?.acquired, 'the recorded route was found and the camera acquired its walker')
  assert.ok(frames < 100_000, 'the saved replay settled within the test bound')
})
