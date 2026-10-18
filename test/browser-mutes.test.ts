import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { BROWSER_MUTES_KEY, BROWSER_MUTES_MAX_ITEMS, BROWSER_MUTES_VERSION, FOUNDER_RESIDENT_ID, compileMutes, hiddenByMutes,
  hiddenPlaces, nearestPlaceChoice, parseBrowserMutes, readBrowserMutes, type BrowserMute, type MutePlace,
  type MuteSubject } from '../src/browser-mutes.ts'

type Fixture = {
  key: string
  version: number
  max_items: number
  founder_resident_id: number
  parse: { name: string; raw: string | null; items: BrowserMute[] }[]
  places: MutePlace[]
  judge: { name: string; items: BrowserMute[]; subject: MuteSubject; hidden: boolean }[]
}

const fixture = JSON.parse(await readFile(new URL('./fixtures/browser-mutes-fixture.json', import.meta.url), 'utf8')) as Fixture

test('the shared fixture names the same key, version, cap and founder as this page', () => {
  assert.equal(fixture.key, BROWSER_MUTES_KEY)
  assert.equal(fixture.version, BROWSER_MUTES_VERSION)
  assert.equal(fixture.max_items, BROWSER_MUTES_MAX_ITEMS)
  assert.equal(fixture.founder_resident_id, FOUNDER_RESIDENT_ID)
  assert.ok(fixture.parse.length >= 30 && fixture.judge.length >= 60)
})

for (const row of fixture.parse) {
  test(`stored list: ${row.name}`, () => {
    assert.deepEqual(parseBrowserMutes(row.raw), row.items)
  })
}

for (const row of fixture.judge) {
  test(`mute rule: ${row.name}`, () => {
    const rules = compileMutes(row.items)
    assert.equal(hiddenByMutes(row.subject, rules, hiddenPlaces(rules, fixture.places)), row.hidden)
  })
}

test('the parsed list is frozen and an undefined value is an empty list', () => {
  const parsed = parseBrowserMutes('{"version":1,"items":[{"type":"resident","id":12,"choice":"mute"}]}')
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed[0]))
  assert.deepEqual(parseBrowserMutes(undefined), [])
})

test('reading the list never throws: missing, blocked or failing storage gives an empty list', () => {
  const stored = '{"version":1,"items":[{"type":"place","id":249,"choice":"mute"}]}'
  const keys: string[] = []
  assert.deepEqual(readBrowserMutes(() => ({ getItem: key => { keys.push(key); return stored } })),
    [{ type: 'place', id: 249, choice: 'mute' }])
  assert.deepEqual(keys, [BROWSER_MUTES_KEY])
  assert.deepEqual(readBrowserMutes(() => undefined), [])
  assert.deepEqual(readBrowserMutes(() => { throw new Error('storage is unavailable') }), [])
  assert.deepEqual(readBrowserMutes(() => ({ getItem: () => { throw new Error('denied') } })), [])
  assert.deepEqual(readBrowserMutes(() => ({ getItem: () => null })), [])
  assert.deepEqual(readBrowserMutes(() => ({ getItem: () => '{"version":9,"items":[]}' })), [])
  // Node has no browser storage: the default reader must still answer.
  assert.deepEqual(readBrowserMutes(), [])
})

test('compiling keeps only choices that can matter', () => {
  const rules = compileMutes([
    { type: 'resident', id: 1, choice: 'mute' }, { type: 'resident', id: 12, choice: 'mute' },
    { type: 'resident', id: 13, choice: 'allow' }, { type: 'kind', id: 39, choice: 'allow' }, { type: 'kind', id: 40, choice: 'mute' },
    { type: 'note', id: 5, choice: 'allow' }, { type: 'thing', id: 9, choice: 'mute' }, { type: 'place', id: 3, choice: 'allow' },
  ])
  assert.equal(rules.empty, false)
  assert.deepEqual([...rules.residents], [12])
  assert.deepEqual([...rules.kinds], [40])
  assert.deepEqual([...rules.notes.allowed], [5])
  assert.deepEqual([...rules.things.muted], [9])
  assert.deepEqual([...rules.places], [[3, 'allow']])
  assert.equal(compileMutes([]).empty, true)
})

test('the nearest place choice names the place that carries it', () => {
  const rules = compileMutes([{ type: 'place', id: 10, choice: 'mute' }, { type: 'place', id: 11, choice: 'allow' }])
  const byId = new Map(fixture.places.map(place => [place.id, place]))
  assert.deepEqual(nearestPlaceChoice(rules, byId, 12), { placeId: 11, choice: 'allow' })
  assert.deepEqual(nearestPlaceChoice(rules, byId, 13), { placeId: 10, choice: 'mute' })
  assert.equal(nearestPlaceChoice(rules, byId, 3), null)
  assert.equal(nearestPlaceChoice(rules, byId, 404), null)
  assert.deepEqual([...hiddenPlaces(rules, fixture.places)].sort((left, right) => left - right), [10, 13])
  assert.equal(hiddenPlaces(compileMutes([]), fixture.places).size, 0)
})
