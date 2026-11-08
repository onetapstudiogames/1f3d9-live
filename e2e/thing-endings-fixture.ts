import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fixtureDirectory, json, liveFixtureUrl } from './live-fixture.ts'

// The still room (place 498) holding one live-saved thing and two things shaped by the
// city's own end mappers at 6a6d020: one with an end set and one remnant. See
// docs/CITY-API.md "Thing endings".
export const endingRoomId = 498
export const endingSetId = 40001
export const remnantId = 40002
export const ordinaryId = 2534
export const endingClock = Date.parse('2026-11-08T03:10:30.000Z')

const root = 'public/fixtures/thing-endings'
const thingFiles: Readonly<Record<number, string>> = {
  [endingSetId]: `${root}/thing-40001-ending-set.json`,
  [remnantId]: `${root}/thing-40002-remnant.json`,
  [ordinaryId]: `${root}/thing-2534-live.json`,
}

export async function installEndingRoom(page: Page): Promise<{ external: string[]; errors: string[]; thingReads: number[] }> {
  const directory = await fixtureDirectory()
  const placeById = new Map((directory['places'] as Array<Record<string, unknown>>).map(place => [place['id'] as number, place]))
  const outline = await readFile(`${root}/place-498-outline.json`, 'utf8')
  const changes = await readFile(`${root}/changes-thing-ended.json`, 'utf8')
  const drawing2534 = await readFile('public/fixtures/drawings/thing-2534.json', 'utf8')
  const external: string[] = []; const errors: string[] = []; const thingReads: number[] = []
  let changesServed = false
  const fixtureOrigin = new URL(test.info().project.use.baseURL!).origin
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== fixtureOrigin) { external.push(url.href); await route.abort(); return }
    if (url.pathname === '/ending-census.json') {
      await json(route, { residents: [{ id: 223, handle: 'serein', model: '', joined_at: '2026-09-01T00:00:00.000Z',
        has_drawing: false, current_place_id: endingRoomId, asleep: false }], returned_items: 1, has_more: false, next_before_id: null })
      return
    }
    if (url.pathname === '/ending-directory.json') { await json(route, directory); return }
    if (url.pathname === '/ending-cursor.json') { await json(route, { change_marker: '100297' }); return }
    if (url.pathname === '/ending-changes.json') {
      if (changesServed) {
        await json(route, { change_marker: '100300', next_since: '100300', has_more: false, unchanged: true, returned_items: 0, changes: [] })
      } else { changesServed = true; await route.fulfill({ contentType: 'application/json', body: changes }) }
      return
    }
    if (url.pathname === `/fixtures/places/place-${endingRoomId}.json`) { await route.fulfill({ contentType: 'application/json', body: outline }); return }
    const otherOutline = /^\/fixtures\/places\/place-(\d+)\.json$/.exec(url.pathname)
    if (otherOutline) {
      const id = Number(otherOutline[1]); const place = placeById.get(id)
      if (!place) { await json(route, {}, 404); return }
      await json(route, { view: 'outline', place: { id, parent_id: place['parent_id'], name: place['name'], owner: place['owner'] ?? null,
        owner_id: place['owner_id'] ?? null, quiet: place['quiet'], laws: [] },
      things: [], things_page: { total_items: 0, returned_items: 0, has_more: false, next_before_thing_id: null } })
      return
    }
    const thing = /^\/fixtures\/things\/thing-(\d+)\.json$/.exec(url.pathname)
    if (thing) {
      const id = Number(thing[1]); thingReads.push(id)
      const file = thingFiles[id]
      if (file) await route.fulfill({ contentType: 'application/json', body: await readFile(file, 'utf8') })
      else await json(route, {}, 404)
      return
    }
    const drawing = /^\/fixtures\/drawings\/(resident|thing)-(\d+)\.json$/.exec(url.pathname)
    if (drawing) {
      if (drawing[1] === 'thing' && Number(drawing[2]) === ordinaryId) await route.fulfill({ contentType: 'application/json', body: drawing2534 })
      else await json(route, {}, 404)
      return
    }
    await route.continue()
  })
  return { external, errors, thingReads }
}

export function endingRoomUrl(): string {
  return liveFixtureUrl
    .replace('/fixtures/residents-presence-page1.json', '/ending-census.json')
    .replace('/fixtures/map-current-page1.json', '/ending-directory.json')
    .replace('/fixtures/change-cursor.json', '/ending-cursor.json')
    .replace('/fixtures/changes-live.json', '/ending-changes.json') + `&place=${endingRoomId}`
}

export type ShownThing = Readonly<{ id: number; name: string | null; x: number; y: number; texture: string }>

export async function shownThings(page: Page): Promise<ShownThing[]> {
  return page.evaluate(() => JSON.parse(document.body.dataset['liveThings'] ?? '[]') as ShownThing[])
}

export async function openEndingRoom(page: Page): Promise<void> {
  await page.goto(endingRoomUrl())
  await expect.poll(async () => {
    await page.clock.runFor(16)
    return await page.locator('body').getAttribute('data-live-ready')
  }, { timeout: 30_000 }).toBe('true')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', String(endingRoomId))
  await expect.poll(async () => { await page.clock.runFor(50); return (await shownThings(page)).length }, { timeout: 30_000 }).toBe(3)
}

export async function clickThing(page: Page, id: number): Promise<void> {
  const thing = (await shownThings(page)).find(row => row.id === id)!
  await page.locator('#app canvas').click({ position: { x: thing.x, y: thing.y } })
}
