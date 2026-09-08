import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneHistory, type PresentationState } from '../src/scenes/SceneHistory.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { createResidents, stepResidents, retimeResidentWalks } from '../src/replay/simulation.ts'
import { createThings } from '../src/things.ts'
import { createHandovers } from '../src/handovers.ts'
import { createClock } from '../src/replay/index.ts'
import { emptyActivity } from '../src/activity.ts'
import { emptyCueState } from '../src/activity-cues.ts'
import type { ReplayFile, Resident } from '../src/city/types.ts'
import { rebaseActiveLooks, visibleLookingIds, type ActivitySnapshot } from '../src/activity-snapshot.ts'

const at = '2026-09-07T00:00:00Z'
const replay: ReplayFile = { span: '24h', window_start: at, window_end: '2026-09-08T00:00:00Z', checkpoint: '1', complete: true,
  row_ceiling: 800, counts: {}, map: { places: [
    { id: 1, name: 'world', parent_id: null, owner: null, owner_id: null, quiet: false, has_drawing: false },
    { id: 2, name: 'room', parent_id: 1, owner: null, owner_id: null, quiet: false, has_drawing: false },
  ] }, start: { 'resident:1': { place_id: 1 } }, timeline: [
    { change_id: '1', event_id: 1, at, actor: 'one', kind: 'action', detail: { action: 'move', status: 'applied', from_place_id: 1, to_place_id: 2 } },
  ] }
const census: Resident[] = [{ id: 1, handle: 'one', current_place_id: 1, joined_at: at, model: 'test', asleep: false, has_drawing: false }]

test('rewind restores an earlier walk and log together, then normal resumes without a jump', () => {
  const layout = nestedLayout(replay.map.places)
  const things = createThings(replay, layout)
  let residents = stepResidents(createResidents(replay, census, layout), replay.timeline, 0, 0, layout, 60)
  const frame = (elapsed: number): PresentationState => ({
    clock: createClock(at, replay.window_end, 60), residents, things, handovers: createHandovers(replay.timeline),
    inventions: { moments: [], pending: false, issues: [] }, placeAnimations: [], elapsed, cursor: 1, mode: 'replay',
    liveDeliveredMarker: 1, sleepers: new Set(), agreements: [],
    activity: { log: { ...emptyActivity(), seenKeys: [String(elapsed)] }, cues: emptyCueState() },
  })
  const history = new SceneHistory(); history.reset(frame(0))
  let earlier: PresentationState | undefined
  for (let time = 250; time <= 3_000; time += 250) {
    residents = stepResidents(residents, [], 250, time, layout, 60)
    const next = frame(time); history.record(next)
    if (time === 1_500) earlier = next
  }
  const rewound = history.rewind(50)!
  assert.equal(rewound.elapsed, 1_500)
  assert.deepEqual(rewound.residents, earlier!.residents)
  assert.deepEqual(rewound.activity, earlier!.activity)
  assert.equal(history.rewound, true)
  const normal = retimeResidentWalks(rewound.residents, 1, layout)
  assert.equal(normal.residents[1]!.x, rewound.residents.residents[1]!.x)
  assert.equal(normal.residents[1]!.y, rewound.residents.residents[1]!.y)
  history.resume(); history.record({ ...rewound, residents: normal, elapsed: 1_750 })
  assert.equal(history.rewound, false)
  assert.equal(history.rewind(1_000)!.elapsed, 0)
  assert.equal(history.canRewind, false)
  history.reset(frame(0)); assert.equal(history.canRewind, false)
})

test('an activity snapshot keeps temporary looking visibility and follow activity at capture time', () => {
  const activity: ActivitySnapshot = Object.freeze({
    log: emptyActivity(), cues: emptyCueState(), looking: { burstsByResident: { 1: 'looking:1:2:start' } },
    activeLooks: [{ residentId: 1, key: 'looking:1:2:start', expiresAt: 2_000 }],
    recent: [[1, { key: 'looking:1:2:start', startedAt: 30 }]] as const, activeResidents: [1], capturedWallNow: 1_000,
  })
  const layout = nestedLayout(replay.map.places)
  const state: PresentationState = { clock: createClock(at, replay.window_end, 1), residents: createResidents(replay, census, layout),
    things: createThings(replay, layout), handovers: createHandovers([]), inventions: { moments: [], pending: false, issues: [] },
    placeAnimations: [], elapsed: 1_000, cursor: 0, mode: 'live', liveDeliveredMarker: 0, sleepers: new Set(), agreements: [], activity }
  const history = new SceneHistory(); history.reset(state); history.record({ ...state, elapsed: 2_000 }, true)
  const restored = history.rewind(1_000)!.activity!
  assert.deepEqual([...visibleLookingIds(restored.activeLooks ?? [], restored.capturedWallNow!)], [1])
  assert.deepEqual(restored.recent, [[1, { key: 'looking:1:2:start', startedAt: 30 }]])
  assert.deepEqual(restored.activeResidents, [1])
  assert.deepEqual(restored.looking, { burstsByResident: { 1: 'looking:1:2:start' } })
  const resumed = rebaseActiveLooks(restored.activeLooks ?? [], restored.capturedWallNow!, 50_000)
  assert.deepEqual([...visibleLookingIds(resumed, 50_999)], [1])
  assert.deepEqual([...visibleLookingIds(resumed, 51_000)], [])
})
