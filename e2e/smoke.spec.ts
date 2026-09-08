import { test, expect, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'

const fixtureUrl = '/?replay=/fixtures/replay-24h.json&census=/fixtures/residents-presence-page1.json&drawings=/fixtures/drawings&places=/fixtures/places'
const removedControlIds = ['rewind', 'normal', 'fast', 'live-now', 'replay-day', 'nearby', 'city', 'follow-stop', 'show-sleepers', 'minimap-toggle', 'minimap-canvas', 'ui-toggle', 'activity-panel', 'activity-filter', 'activity-toggle']
type Resident = { id: number; current_place_id: number }
type Place = { id: number; parent_id: number | null; quiet: boolean }

async function fixtureResidents(): Promise<Resident[]> {
  const pages = await Promise.all([1, 2].map(async page =>
    JSON.parse(await readFile(`public/fixtures/residents-presence-page${page}.json`, 'utf8')) as { residents: Resident[] }))
  return pages.flatMap(page => page.residents)
}

async function fixturePlaces(): Promise<Place[]> {
  const replay = JSON.parse(await readFile('public/fixtures/replay-24h.json', 'utf8')) as { map: { places: Place[] } }
  return replay.map.places
}

function publicPlaceIds(places: Place[]): Set<number> {
  const byId = new Map(places.map(place => [place.id, place]))
  return new Set(places.filter(place => {
    const seen = new Set<number>(); let current: Place | undefined = place
    while (current) {
      if (current.quiet || seen.has(current.id)) return false
      seen.add(current.id)
      if (current.parent_id === null) return true
      current = byId.get(current.parent_id)
    }
    return false
  }).map(place => place.id))
}

async function openFixture(page: Page): Promise<{ external: string[]; errors: string[] }> {
  const external: string[] = []; const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://localhost:4173') { external.push(url.href); await route.abort(); return }
    const drawing = /^\/fixtures\/drawings\/resident-(\d+)\.json$/.exec(url.pathname)
    if (drawing) {
      try { await route.fulfill({ contentType: 'application/json', body: await readFile(`public/fixtures/drawings/resident-${drawing[1]}.json`, 'utf8') }) }
      catch { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }) }
      return
    }
    await route.continue()
  })
  await page.goto(fixtureUrl)
  return { external, errors }
}

async function waitUntilReady(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.body.dataset['liveReady'] ?? ''), { timeout: 30_000 }).toBe('true')
  await expect(page.locator('body')).toHaveAttribute('data-live-mode', 'live')
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
}

async function visibleFigures(page: Page): Promise<Array<{ id: number; x: number; y: number }>> {
  return page.evaluate(() => JSON.parse(document.body.dataset['liveFigures'] ?? '[]'))
}

test('opens live in the busiest room with only the one-room controls', async ({ page }) => {
  const diagnostics = await openFixture(page); await waitUntilReady(page)
  const places = await fixturePlaces(); const publicIds = publicPlaceIds(places); const counts = new Map<number, number>()
  for (const resident of await fixtureResidents()) if (publicIds.has(resident.current_place_id)) counts.set(resident.current_place_id, (counts.get(resident.current_place_id) ?? 0) + 1)
  const busiestRoom = [...publicIds].sort((left, right) => (counts.get(right) ?? 0) - (counts.get(left) ?? 0) || left - right)[0]
  expect(busiestRoom).toBeDefined()
  await expect(page.locator('body')).toHaveAttribute('data-live-room', String(busiestRoom))
  await expect(page.locator('body')).toHaveAttribute('data-live-paused', 'false')
  await expect(page.locator('select')).toHaveCount(2)
  await expect(page.locator('button')).toHaveCount(1)
  await expect(page.locator('#follow-picker')).toHaveAttribute('aria-label', 'Choose resident')
  await expect(page.locator('#place-picker')).toHaveAttribute('aria-label', 'Choose place')
  await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Pause')
  await expect(page.locator(removedControlIds.map(id => `#${id}`).join(','))).toHaveCount(0)
  await mkdir('docs/screenshots', { recursive: true })
  await page.screenshot({ path: 'docs/screenshots/latest.png' })
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('resident and place choices control the one room', async ({ page }) => {
  const diagnostics = await openFixture(page); await waitUntilReady(page)
  const residents = await fixtureResidents()
  const roomByResident = Object.fromEntries(residents.map(resident => [String(resident.id), String(resident.current_place_id)]))
  const placeValues = await page.locator('#place-picker option:not([value=""])').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))
  const currentRoom = await page.locator('body').getAttribute('data-live-room')
  const residentValue = await page.locator('#follow-picker option:not([value=""])').evaluateAll((options, args) => {
    const { current, places, rooms } = args as { current: string | null; places: string[]; rooms: Record<string, string> }
    return options.map(option => (option as HTMLOptionElement).value).find(value => rooms[value] !== current && places.includes(rooms[value] ?? '')) ?? ''
  }, { current: currentRoom, places: placeValues, rooms: roomByResident })
  expect(residentValue).not.toBe('')
  await page.locator('#follow-picker').selectOption(residentValue)
  await expect(page.locator('body')).toHaveAttribute('data-live-following', residentValue)
  await expect(page.locator('body')).toHaveAttribute('data-live-room', roomByResident[residentValue]!)
  const occupiedRooms = new Set(residents.map(resident => String(resident.current_place_id)))
  const emptyRoom = placeValues.find(value => !occupiedRooms.has(value))
  expect(emptyRoom).toBeDefined()
  await page.locator('#place-picker').selectOption(emptyRoom!)
  await expect(page.locator('body')).toHaveAttribute('data-live-room', emptyRoom!)
  await expect(page.locator('body')).toHaveAttribute('data-live-following', '')
  await expect.poll(() => visibleFigures(page)).toEqual([])
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('pause freezes the frame and pointer navigation does nothing', async ({ page }) => {
  const diagnostics = await openFixture(page); await waitUntilReady(page)
  const pause = page.locator('#pause'); await pause.click()
  await expect(page.locator('body')).toHaveAttribute('data-live-paused', 'true')
  await expect(pause).toHaveAttribute('aria-label', 'Resume')
  const roomBefore = await page.locator('body').getAttribute('data-live-room')
  const frameBefore = await visibleFigures(page)
  const box = await page.locator('#app canvas').boundingBox(); expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width * 0.4, box!.y + box!.height * 0.4); await page.mouse.down()
  await page.mouse.move(box!.x + box!.width * 0.65, box!.y + box!.height * 0.6, { steps: 4 }); await page.mouse.up(); await page.mouse.wheel(0, -180)
  await expect(page.locator('body')).toHaveAttribute('data-live-room', roomBefore!)
  await expect.poll(() => visibleFigures(page)).toEqual(frameBefore)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('phone layout keeps the room large and controls at the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const diagnostics = await openFixture(page); await waitUntilReady(page)
  const header = await page.locator('header').boundingBox()
  const controls = await page.locator('#room-footer').boundingBox()
  const app = await page.locator('#app').boundingBox()
  const canvas = await page.locator('#app canvas').boundingBox()
  expect(header).not.toBeNull(); expect(controls).not.toBeNull(); expect(app).not.toBeNull(); expect(canvas).not.toBeNull()
  expect(header!.height).toBeLessThanOrEqual(60)
  expect(controls!.y + controls!.height).toBeGreaterThanOrEqual(800)
  expect(app!.width).toBeGreaterThanOrEqual(365)
  expect(canvas!.width).toBeGreaterThanOrEqual(app!.width - 2)
  expect(canvas!.height).toBeGreaterThanOrEqual(app!.height - 2)
  expect(await page.evaluate(() => ({ horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth, vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight }))).toEqual({ horizontal: false, vertical: false })
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})
