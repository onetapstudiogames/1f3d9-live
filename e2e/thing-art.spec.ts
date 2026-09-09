import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { advanceToLivePoll, fixtureDirectory, json, liveFixtureUrl } from './live-fixture.ts'

type ShownThing = {
  id: number
  name: string | null
  x: number
  y: number
  texture: string
  width: number
  height: number
}

const roomId = 498
const thingIds = [2534, ...Array.from({ length: 22 }, (_, index) => 30_001 + index)]

function outlinePage(ids: readonly number[], hasMore: boolean, next: number | null): Record<string, unknown> {
  return {
    view: 'outline',
    place: { id: roomId, parent_id: 2, name: 'the still room', owner: 'founder', owner_id: 1, quiet: false, laws: [] },
    things: ids.map(id => ({
      id, name: id === 2534 ? '六角の歌留多' : `still-room thing ${id}`, place_id: roomId,
      owner: 'founder', owner_id: 1, current_owner: 'founder', current_owner_id: 1,
      made_by: 'founder', maker_id: 1, kind: null, kind_id: null, birth_revision: null,
      current_revision: null, body_text_bytes: 0, open_to_use: false, created_at: '2026-09-01T00:00:00.000Z',
      // Deliberately no has_drawing: this is the shape returned by the live outline API.
    })),
    things_page: {
      total_items: thingIds.length, returned_items: ids.length, has_more: hasMore,
      next_before_thing_id: next,
    },
  }
}

async function installThingRoom(page: Page): Promise<{
  drawingReads: Map<number, number>
  outlineReads: Map<string, number>
  external: string[]
  errors: string[]
}> {
  const directory = await fixtureDirectory()
  const directoryPlaces = (directory['places'] as Array<Record<string, unknown>>)
  const placeById = new Map(directoryPlaces.map(place => [place['id'] as number, place]))
  const drawing2534 = await readFile('public/fixtures/drawings/thing-2534.json', 'utf8')
  const pages = [
    outlinePage(thingIds.slice(0, 10), true, thingIds[9]!),
    outlinePage(thingIds.slice(10, 20), true, thingIds[19]!),
    outlinePage(thingIds.slice(20), false, null),
  ]
  const drawingReads = new Map<number, number>()
  const external: string[] = []
  const errors: string[] = []
  const outlineByPath = new Map([
    ['/fixtures/places/place-498.json', pages[0]!],
    [`/fixtures/places/place-498-before-${thingIds[9]}.json`, pages[1]!],
    [`/fixtures/places/place-498-before-${thingIds[19]}.json`, pages[2]!],
  ])
  const outlineReads = new Map<string, number>()
  const fixtureOrigin = new URL(test.info().project.use.baseURL!).origin
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== fixtureOrigin) { external.push(url.href); await route.abort(); return }
    if (url.pathname === '/thing-art-census-page1.json') {
      await json(route, { residents: [], returned_items: 0, has_more: false, next_before_id: null }); return
    }
    if (url.pathname === '/thing-art-directory.json') { await json(route, directory); return }
    if (url.pathname === '/thing-art-cursor.json') { await json(route, { change_marker: '100297' }); return }
    if (url.pathname === '/thing-art-changes.json') {
      await json(route, { change_marker: '100297', next_since: '100297', has_more: false, unchanged: true, returned_items: 0, changes: [] }); return
    }
    const outline = outlineByPath.get(url.pathname)
    if (outline) {
      outlineReads.set(url.pathname, (outlineReads.get(url.pathname) ?? 0) + 1)
      await json(route, outline); return
    }
    const otherOutline = /^\/fixtures\/places\/place-(\d+)(?:-before-\d+)?\.json$/.exec(url.pathname)
    if (otherOutline) {
      const id = Number(otherOutline[1]); const place = placeById.get(id)
      if (!place) { await json(route, {}, 404); return }
      await json(route, {
        view: 'outline',
        place: { id, parent_id: place['parent_id'], name: place['name'], owner: place['owner'] ?? null,
          owner_id: place['owner_id'] ?? null, quiet: place['quiet'], laws: [] },
        things: [], things_page: { total_items: 0, returned_items: 0, has_more: false, next_before_thing_id: null },
      }); return
    }
    const drawing = /^\/fixtures\/drawings\/thing-(\d+)\.json$/.exec(url.pathname)
    if (drawing) {
      const id = Number(drawing[1]); drawingReads.set(id, (drawingReads.get(id) ?? 0) + 1)
      if (id === 2534) await route.fulfill({ contentType: 'application/json', body: drawing2534 })
      else await json(route, {}, 404)
      return
    }
    const residentDrawing = /^\/fixtures\/drawings\/resident-(\d+)\.json$/.exec(url.pathname)
    if (residentDrawing) { await json(route, {}, 404); return }
    await route.continue()
  })
  return { drawingReads, outlineReads, external, errors }
}

function fixtureUrl(): string {
  return liveFixtureUrl
    .replace('/fixtures/residents-presence-page1.json', '/thing-art-census-page1.json')
    .replace('/fixtures/map-current-page1.json', '/thing-art-directory.json')
    .replace('/fixtures/change-cursor.json', '/thing-art-cursor.json')
    .replace('/fixtures/changes-live.json', '/thing-art-changes.json')
}

async function shownThings(page: Page): Promise<ShownThing[]> {
  return page.evaluate(() => JSON.parse(document.body.dataset['liveThings'] ?? '[]') as ShownThing[])
}

async function chooseStillRoom(page: Page): Promise<void> {
  await page.goto(fixtureUrl())
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  await page.locator('#place-picker').selectOption(String(roomId))
  await expect(page.locator('body')).toHaveAttribute('data-live-room', String(roomId))
  await expect.poll(() => shownThings(page), { timeout: 30_000 }).toHaveLength(thingIds.length)
  await expect(page.locator('#live-status')).toBeEmpty()
}

async function waitForCapturePicture(page: Page): Promise<void> {
  await advanceToLivePoll(page)
  await expect(page.locator('body')).toHaveAttribute('data-live-picture-settled', 'true')
  const count = await page.locator('body').getAttribute('data-live-things-count')
  await page.clock.runFor(1_000)
  await expect(page.locator('body')).toHaveAttribute('data-live-things-count', count ?? '')
  await expect(page.locator('#live-status')).toBeEmpty()
}

function expectNoThingOverlap(things: readonly ShownThing[]): void {
  for (let left = 0; left < things.length; left += 1) {
    for (let right = left + 1; right < things.length; right += 1) {
      const a = things[left]!; const b = things[right]!
      const separated = a.x + a.width / 2 <= b.x - b.width / 2
        || b.x + b.width / 2 <= a.x - a.width / 2
        || a.y + a.height / 2 <= b.y - b.height / 2
        || b.y + b.height / 2 <= a.y - a.height / 2
      expect(separated, `thing ${a.id} overlaps thing ${b.id}`).toBe(true)
    }
  }
}

test('shown outline things use saved art once and survive room switching', async ({ page }) => {
  await page.clock.install({ time: Date.parse('2026-09-09T12:00:00.000Z') })
  const diagnostics = await installThingRoom(page)
  await chooseStillRoom(page)
  await waitForCapturePicture(page)
  await expect.poll(async () => (await shownThings(page)).find(thing => thing.id === 2534)?.texture)
    .toBe('thing-2534')
  const things = await shownThings(page)
  expect(things.map(thing => thing.id).sort((a, b) => a - b)).toEqual([...thingIds].sort((a, b) => a - b))
  expect(things.find(thing => thing.id === 2534)).toMatchObject({ texture: 'thing-2534', width: 32, height: 32 })
  expectNoThingOverlap(things)
  await expect.poll(() => [...diagnostics.drawingReads.keys()].sort((a, b) => a - b)).toEqual([...thingIds].sort((a, b) => a - b))
  expect([...diagnostics.drawingReads.values()].every(count => count === 1)).toBe(true)
  expect([...diagnostics.outlineReads.entries()]).toEqual([
    ['/fixtures/places/place-498.json', 2],
    [`/fixtures/places/place-498-before-${thingIds[9]}.json`, 2],
    [`/fixtures/places/place-498-before-${thingIds[19]}.json`, 2],
  ])

  await page.locator('#place-picker').selectOption('438')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '438')
  await page.locator('#place-picker').selectOption(String(roomId))
  await expect.poll(() => shownThings(page)).toHaveLength(thingIds.length)
  expect([...diagnostics.drawingReads.values()].every(count => count === 1)).toBe(true)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('a 375px room shows all 23 things without overlapping their 32px art', async ({ page }) => {
  await page.clock.install({ time: Date.parse('2026-09-09T12:00:00.000Z') })
  await page.setViewportSize({ width: 375, height: 812 })
  const diagnostics = await installThingRoom(page)
  await chooseStillRoom(page)
  await waitForCapturePicture(page)
  const things = await shownThings(page)
  expect(things).toHaveLength(23)
  expect(things.every(thing => thing.width === 32 && thing.height === 32)).toBe(true)
  expectNoThingOverlap(things)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('a room too small to draw makes no thing drawing reads until it grows', async ({ page }) => {
  await page.setViewportSize({ width: 136, height: 300 })
  const diagnostics = await installThingRoom(page)
  await page.goto(fixtureUrl())
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  await page.locator('#place-picker').selectOption(String(roomId))
  await expect(page.locator('body')).toHaveAttribute('data-live-room', String(roomId))
  await expect(page.locator('#live-status')).toHaveText('This window is too small to draw the room.')
  await expect.poll(() => diagnostics.outlineReads.size).toBe(3)
  expect(diagnostics.drawingReads.size).toBe(0)

  await page.setViewportSize({ width: 375, height: 812 })
  await expect.poll(() => shownThings(page), { timeout: 30_000 }).toHaveLength(23)
  await expect.poll(() => diagnostics.drawingReads.size).toBe(23)
  expect([...diagnostics.drawingReads.values()].every(count => count === 1)).toBe(true)
  await expect(page.locator('#live-status')).toBeEmpty()
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})
