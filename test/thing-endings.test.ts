import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { roomSettleWords, thingEndedWords } from '../src/ability-events.ts'
import { activityEntry, type ActivityContext } from '../src/activity.ts'
import { fetchPlaceOutline, fetchThing } from '../src/city/api.ts'
import { parseShortEnds, parseThingEnding, shortEndsKey, thingIsRemnant } from '../src/city/thing-ending.ts'
import type { OutlineThing, PlaceOutline, ReplayEvent } from '../src/city/types.ts'
import { refreshPresentThings } from '../src/current-things.ts'
import type { NestedLayout } from '../src/ground/nested.ts'
import { thingEndingFacts, thingPanelFacts } from '../src/item-panel.ts'
import { REMNANT_TEXTURE_SUFFIX, remnantDrawingCells, thingDrawingCells, thingTextureKey } from '../src/thing-art.ts'
import { stepThings, type ThingSimulation, type ThingState } from '../src/things.ts'

// Saved from the live city (GET only, 2026-11-08T03:07Z, deployment 6a6d020) and built
// with the city's own mappers at 6a6d020 (thingEndingRead, shortEndingStatus); see
// docs/CITY-API.md "Thing endings".
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/thing-endings/${name}`, import.meta.url), 'utf8')
const json = (name: string): Record<string, any> => JSON.parse(fixture(name)) as Record<string, any>
const utc = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`

const liveUnset = json('thing-1536-live.json').thing
const liveNotPermitted = json('thing-2534-live.json').thing
const endingSet = json('thing-40001-ending-set.json').thing
const remnant = json('thing-40002-remnant.json').thing
const outline = json('place-498-outline.json')

test('the saved fixtures match the public fixture tree byte for byte', () => {
  for (const name of ['thing-1536-live.json', 'thing-2534-live.json', 'thing-40001-ending-set.json', 'thing-40002-remnant.json',
    'place-498-outline.json', 'changes-thing-ended.json', 'changes-room-settled-live.json']) {
    assert.equal(fixture(name), readFileSync(new URL(`../public/fixtures/thing-endings/${name}`, import.meta.url), 'utf8'), name)
  }
})

test('the live thing read carries the full ending object, and neither saved live thing has an end', () => {
  assert.equal(liveUnset.ending.status, 'permitted_but_unset')
  assert.equal(liveNotPermitted.ending.status, 'not_permitted_by_kind')
  assert.equal(liveUnset.end_program_summary, 'When this ends it becomes a remnant.')
  for (const thing of [liveUnset, liveNotPermitted]) {
    const parsed = parseThingEnding(thing.ending)
    assert.ok(parsed)
    assert.deepEqual(thingEndingFacts(parsed, thing.end_program_summary, utc), [])
  }
})

test('an unreadable ending reads as no ending, never as a guess', () => {
  assert.equal(parseThingEnding(null), null)
  assert.equal(parseThingEnding({ status: 'gone' }), null)
  assert.equal(parseThingEnding('ended'), null)
  assert.equal(parseShortEnds(undefined), null)
  assert.equal(parseShortEnds({ state: 'over', at: null }), null)
  assert.equal(parseShortEnds({ state: 'ended', at: 'yesterday' }), null)
  assert.deepEqual(parseShortEnds({ state: 'set', at: null }), { state: 'set', at: null })
})

test('an end that is set shows "Ends" with each condition the read computed and the city sentence', () => {
  const ending = parseThingEnding(endingSet.ending)!
  assert.equal(ending.status, 'active')
  assert.deepEqual(thingEndingFacts(ending, endingSet.end_program_summary, utc), [
    { label: 'Ends', value: 'on 2026-11-20 18:00 UTC or after 3 more uses' },
    { label: 'When it ends', value: "When this ends it becomes a remnant, then, if waking is on for it and its room lets it wake, the next time a resident is in its room it runs ember's end steps once: writes its own state box." },
  ])
})

test('every other condition reads in the city window words', () => {
  const ending = parseThingEnding({ ...endingSet.ending, conditions: [
    { after_setting_seconds: 86400, ends_at: '2026-11-08T12:00:00.000Z' },
    { idle_seconds: 600, unused_deadline: '2026-11-08T12:10:00.000Z' },
    { label_added: 'spent' },
    { uses: 1, uses_left: 1 },
  ] })!
  assert.deepEqual(thingEndingFacts(ending, null, utc), [{ label: 'Ends',
    value: 'on 2026-11-08 12:00 UTC or if unused until 2026-11-08 12:10 UTC or when labeled spent or after 1 more use' }])
  assert.deepEqual(thingEndingFacts(parseThingEnding({ ...endingSet.ending, conditions: [] })!, null, utc),
    [{ label: 'Ends', value: 'an end is set' }])
})

test('a remnant shows "Ended" with its recorded end, and a due end reads ended before it is written down', () => {
  const ended = parseThingEnding(remnant.ending)!
  assert.equal(ended.status, 'ended')
  assert.deepEqual(thingEndingFacts(ended, remnant.end_program_summary, utc), [
    { label: 'Ended', value: 'on 2026-11-07 03:00 UTC; it is a remnant now' },
  ])
  const due = parseThingEnding({ ...endingSet.ending, status: 'due_waiting_settle' })!
  assert.deepEqual(thingEndingFacts(due, endingSet.end_program_summary, utc), [
    { label: 'Ended', value: 'on 2026-11-20 18:00 UTC; it is a remnant now' },
  ])
})

test('thing panel facts put the end after the owner and before the description', () => {
  const facts = thingPanelFacts({ kind: 'candle', owner: 'serein', description: 'A short candle.',
    ending: parseThingEnding(remnant.ending), endProgramSummary: remnant.end_program_summary, formatTime: utc })
  assert.deepEqual(facts.map(fact => fact.label), ['Kind', 'Owner', 'Ended', 'Description'])
  assert.deepEqual(thingPanelFacts({ kind: null, owner: undefined, description: undefined }), [])
})

test('the thing read keeps the ending, and an outline row keeps the short ends only when carried', async (t) => {
  const original = globalThis.fetch
  globalThis.fetch = async input => {
    const url = String(input)
    if (url.includes('thing-40002')) return Response.json(json('thing-40002-remnant.json'))
    if (url.includes('thing-1536')) return Response.json(json('thing-1536-live.json'))
    return Response.json(outline)
  }
  t.after(() => { globalThis.fetch = original })

  const read = await fetchThing(40002, '?things=/fixtures/thing-endings')
  assert.equal(read?.ending?.status, 'ended')
  assert.equal(read?.endProgramSummary, 'When this ends it becomes a remnant.')
  assert.equal((await fetchThing(1536, '?things=/fixtures/thing-endings'))?.ending?.status, 'permitted_but_unset')

  const place = await fetchPlaceOutline(498, '?places=/fixtures/thing-endings')
  const rows = new Map(place!.things.map(row => [row.id, row]))
  assert.deepEqual(rows.get(40002)?.ends, { state: 'ended', at: '2026-11-07T03:00:00.000Z' })
  assert.deepEqual(rows.get(40001)?.ends, { state: 'set', at: '2026-11-20T18:00:00.000Z' })
  assert.equal(Object.hasOwn(rows.get(2534)!, 'ends'), false)
  assert.equal(thingIsRemnant(rows.get(40002)!.ends), true)
  assert.equal(thingIsRemnant(rows.get(40001)!.ends), false)
  assert.equal(thingIsRemnant(undefined), false)
  assert.notEqual(shortEndsKey(rows.get(40001)!.ends), shortEndsKey(rows.get(40002)!.ends))
  assert.equal(shortEndsKey(undefined), shortEndsKey(null))
})

const layout = { rooms: { 498: { id: 498, parentId: null, quiet: false,
  standing: { x: 0, y: 0, width: 640, height: 480 } } } } as unknown as NestedLayout

function thingState(id: number, remnant = false): ThingState {
  return Object.freeze({ id, name: `thing ${id}`, placeId: 498, x: 100 + id % 7, y: 100, visible: true, effect: null, remnant })
}

function simulation(things: readonly ThingState[]): ThingSimulation {
  return Object.freeze({ things: Object.freeze(Object.fromEntries(things.map(thing => [thing.id, thing]))),
    reservations: Object.freeze({}), issues: Object.freeze([]), queue: Object.freeze([]), pending: false })
}

function roomOutline(rows: readonly OutlineThing[]): PlaceOutline {
  return Object.freeze({ placeId: 498, quiet: false, things: Object.freeze(rows), totalItems: rows.length, hasMore: false })
}

const row = (id: number, ends?: OutlineThing['ends']): OutlineThing =>
  Object.freeze({ id, name: `thing ${id}`, placeId: 498, hasDrawing: false, ...(ends === undefined ? {} : { ends }) })

test('a thing is drawn as a remnant only when its own current row says it ended', () => {
  const start = simulation([thingState(40001), thingState(40002)])
  const refreshed = refreshPresentThings(start, roomOutline([row(40001, { state: 'set', at: '2026-11-20T18:00:00.000Z' }),
    row(40002, { state: 'ended', at: '2026-11-07T03:00:00.000Z' })]), layout, [])
  assert.equal(refreshed.things[40001]?.remnant, false)
  assert.equal(refreshed.things[40002]?.remnant, true)
  // A later read that no longer carries ends (an older city answer) clears the mark.
  assert.equal(refreshPresentThings(refreshed, roomOutline([row(40001), row(40002)]), layout, []).things[40002]?.remnant, false)
  // A thing new to the floor takes its status from the row that adds it.
  const added = refreshPresentThings(simulation([]), roomOutline([row(40002, { state: 'ended', at: null })]), layout, [])
  assert.equal(added.things[40002]?.remnant, true)
})

test('a thing_ended event never changes the drawing by itself; the next current read does', () => {
  const event = json('changes-thing-ended.json').changes[0]
  const replay: ReplayEvent = { actor: event.actor, at: event.created_at, change_id: event.change_id, event_id: Number(event.change_id),
    kind: event.kind, detail: event.detail }
  const stepped = stepThings(simulation([thingState(40002)]), [replay], 1_000)
  assert.equal(stepped.things[40002]?.remnant, false)
  assert.equal(stepped.things[40002]?.visible, true)
})

test('remnant art keeps the drawing\'s shape but fades it to stone with a crack', () => {
  const cells = thingDrawingCells(null)
  const faded = remnantDrawingCells(cells)
  assert.ok(faded.length > 0 && faded.length < cells.length, 'the crack removes a few cells')
  assert.ok(faded.every(cell => cells.some(source => source.x === cell.x && source.y === cell.y)), 'no cell is invented')
  for (const cell of faded) {
    const r = cell.color >> 16 & 0xff; const g = cell.color >> 8 & 0xff; const b = cell.color & 0xff
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 24, `cell ${cell.x},${cell.y} is near grey`)
  }
  assert.notDeepEqual(faded.map(cell => cell.color), cells.filter(cell => faded.some(f => f.x === cell.x && f.y === cell.y)).map(cell => cell.color))
  assert.equal(thingTextureKey('thing-40002', true), `thing-40002${REMNANT_TEXTURE_SUFFIX}`)
  assert.equal(thingTextureKey(`thing-40002${REMNANT_TEXTURE_SUFFIX}`, false), 'thing-40002')
  assert.equal(thingTextureKey(`thing-40002${REMNANT_TEXTURE_SUFFIX}`, true), `thing-40002${REMNANT_TEXTURE_SUFFIX}`)
  assert.equal(thingTextureKey('thing-default', false), 'thing-default')
})

const place498 = Object.freeze({ id: 498, name: 'the still room', parentId: null, quiet: false, hasDrawing: false })
function context(quiet = false): ActivityContext {
  return Object.freeze({
    resident: (actor: string) => actor === 'serein' ? Object.freeze({ type: 'resident' as const, id: 223, name: 'serein', hasDrawing: false }) : null,
    place: (id: number) => id === 498 ? Object.freeze({ ...place498, quiet }) : null,
    roomName: (id: number) => id === 498 ? 'the still room' : null,
    thing: (id: number) => id === 40002 ? Object.freeze({ entity: Object.freeze({ type: 'thing' as const, id, name: 'a paper boat, one day long', hasDrawing: false }), placeId: 498 }) : null,
  })
}

const feedRow = (change: Record<string, any>): ReplayEvent => ({ actor: change.actor, at: change.created_at,
  change_id: change.change_id, event_id: Number(change.change_id), kind: change.kind, detail: change.detail })

test('the room log captions thing_ended by the city with its cause, and a settle names the ends it wrote down', () => {
  const [ended, settled] = json('changes-thing-ended.json').changes.map(feedRow)
  assert.equal(activityEntry(ended!, context())?.text,
    'the city recorded the end of a paper boat, one day long: its time after setting ran out; it is a remnant now.')
  assert.equal(activityEntry(settled!, context())?.text,
    'serein arrived; the still room settled and nothing woke: 0 tried, 0 woke, 1 thing ended.')
})

test('a thing_ended row in a quiet room stays out of the log, as thing_edited does', () => {
  const [ended] = json('changes-thing-ended.json').changes.map(feedRow)
  assert.equal(activityEntry(ended!, context(true)), null)
  assert.equal(activityEntry({ ...ended!, kind: 'thing_edited' }, context(true)), null)
})

test('thing_ended words name each cause plainly and drop an unknown one', () => {
  assert.equal(thingEndedWords({ cause: 'at' }, 'a lamp'), 'recorded the end of a lamp: its end date came; it is a remnant now')
  assert.equal(thingEndedWords({ cause: 'uses' }, 'a lamp'), 'recorded the end of a lamp: its uses ran out; it is a remnant now')
  assert.equal(thingEndedWords({ cause: 'idle_seconds' }, 'a lamp'), 'recorded the end of a lamp: it went unused too long; it is a remnant now')
  assert.equal(thingEndedWords({ cause: 'label_added' }, 'a lamp'), 'recorded the end of a lamp: the label it ends on was put on it; it is a remnant now')
  assert.equal(thingEndedWords({ cause: 'something new' }, 'a lamp'), 'recorded the end of a lamp; it is a remnant now')
})

test('the live settle row and every end count read plainly', () => {
  const live = json('changes-room-settled-live.json').changes[0].detail
  assert.equal(roomSettleWords(live, 'the lab'), 'arrived and things woke in the lab: 1 tried, 1 woke')
  assert.equal(roomSettleWords({ ...live, ended: 2, end_tries: 1, more_due: true }, 'the lab'),
    'arrived and things woke in the lab: 1 tried, 1 woke, 2 things ended, 1 end try ran, more ends wait for the next settle')
  // An older row without the end fields reads exactly as before.
  assert.equal(roomSettleWords({ mode: 'arrive', status: 'woke', tried: 8, woke: 8, forfeited: 2 }, 'the lab'),
    'arrived and things woke in the lab: 8 tried, 8 woke, 2 dropped')
})
