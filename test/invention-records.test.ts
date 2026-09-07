import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseChangesPage } from '../src/city/changes.ts'
import type { ReplayFile, Resident } from '../src/city/types.ts'
import { nestedLayout } from '../src/ground/nested.ts'
import { inventionFor, stepInventions } from '../src/inventions.ts'
import { settleAtNow } from '../src/live.ts'
import { createResidents, roomCapacity, stepResidents } from '../src/replay/simulation.ts'

const saved = <T>(name: string): T => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as T
const names = ['kind-invented', 'kind-revised', 'trait-coined', 'trait-coined-page2']
const feeds = names.map(name => parseChangesPage(saved(`changes-${name}.json`)))
const day = saved<ReplayFile>('replay-24h.json')
const census = ['page1', 'page2'].flatMap(page => saved<{ residents: Resident[] }>(`residents-presence-${page}.json`).residents)

test('all saved invention and trait notices retain their recorded actor, name and subject', () => {
  for (const feed of feeds) for (const row of feed.events) {
    const parsed = inventionFor(row)
    assert.ok(parsed, `notice ${row.change_id}`)
    assert.equal(parsed.actor, row.actor)
    assert.equal(parsed.name, row.detail.name)
    assert.equal(parsed.subjectId, row.detail.kind_id ?? row.detail.trait_id)
    assert.equal(parsed.subject, row.kind === 'trait_coined' ? 'trait' : 'kind')
    assert.equal(row.detail.place_id, undefined)
  }
})

test('real notices light their already placed actor without moving it, and opening now clears the old hold', () => {
  for (const feed of feeds) {
    const row = feed.events.at(-1)!
    const person = census.find(resident => resident.handle === row.actor)!
    assert.ok(person)
    // Unit-only starting state: these current census positions make no claim about
    // where an older invention happened. The saved notice itself stays unchanged.
    const replay: ReplayFile = { ...day, window_start: row.at, window_end: row.at,
      checkpoint: row.change_id, start: { [`resident:${person.id}`]: { place_id: person.current_place_id } }, timeline: [row] }
    const layout = nestedLayout(replay.map.places, roomCapacity(replay, [person]))
    const initial = createResidents(replay, [person], layout)
    const before = initial.residents[person.id]!
    const shown = stepResidents(initial, [row], 0, 100, layout)
    const after = shown.residents[person.id]!
    assert.deepEqual([after.placeId, after.x, after.y, after.walking], [before.placeId, before.x, before.y, false])
    const bulbs = stepInventions({ moments: [], pending: false, issues: [] }, shown.startedInventions ?? [], shown, new Set(), 100)
    assert.equal(bulbs.moments.length, 1)
    assert.equal(bulbs.moments[0]!.name, row.detail.name)
    assert.equal(bulbs.moments[0]!.residentId, person.id)
    assert.equal(shown.pending, true)
    const now = settleAtNow(replay, [person], layout)
    assert.equal(now.residents.pending, false)
    assert.equal(now.residents.residents[person.id]!.inventionUntil ?? null, null)
    assert.equal(now.residents.startedInventions?.length ?? 0, 0)
  }
})
