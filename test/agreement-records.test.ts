import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseChangesPage } from '../src/city/changes.ts'
import { parseAgreementPair } from '../src/city/agreements.ts'

const raw = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

test('only three saved signatures have an unambiguous original pair in the current agreement record', () => {
  const agreements = JSON.parse(raw('agreements.json'))
  const signatures = parseChangesPage(JSON.parse(raw('changes-agreement-sign.json'))).events
  assert.deepEqual(signatures.filter(row => parseAgreementPair(agreements, row) !== null).map(row => row.change_id),
    ['2203', '11273', '11288'])
  for (const row of signatures) {
    assert.deepEqual(Object.keys(row.detail), ['agreement_id'])
    assert.equal(row.detail.place_id, undefined)
  }
})

test('older signed agreement evidence does not manufacture missing historical rooms', () => {
  const signEvents = JSON.parse(raw('events-agreement-sign.json')).events
  const row = signEvents.find((event: { id: number }) => event.id === 11289)
  assert.equal(row.actor, 'astrolabe')
  assert.equal(row.change_id, '11288')
  assert.deepEqual(row.detail, { agreement_id: 14 })
  for (const actor of ['chronicle', 'astrolabe']) {
    const file = `events-${actor}-before-sign.json`
    const page = JSON.parse(raw(file))
    assert.equal(page.returned_items, 20)
    for (const event of page.events) {
      assert.equal(event.actor, actor)
      assert.ok(event.id < row.id)
      assert.equal(event.detail.from_place_id, undefined)
      assert.equal(event.detail.to_place_id, undefined)
      assert.equal(event.detail.place_id, undefined)
    }
  }
  for (const file of ['events-agreement-sign.json', 'events-chronicle-before-sign.json', 'events-astrolabe-before-sign.json']) {
    assert.equal(raw(file), readFileSync(new URL(`../public/fixtures/${file}`, import.meta.url), 'utf8'))
  }
})
