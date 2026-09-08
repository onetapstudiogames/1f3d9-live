import { test, expect, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { keepFixtureOffline, liveFixtureUrl } from './live-fixture.ts'

const fixtureUrl = liveFixtureUrl
const removedControlIds = ['rewind', 'normal', 'fast', 'live-now', 'replay-day', 'nearby', 'city', 'follow-stop', 'show-sleepers', 'minimap-toggle', 'minimap-canvas', 'ui-toggle', 'activity-panel', 'activity-filter', 'activity-toggle']
type Resident = { id: number; current_place_id: number }

async function fixtureResidents(): Promise<Resident[]> {
  const pages = await Promise.all([1, 2].map(async page =>
    JSON.parse(await readFile(`public/fixtures/residents-presence-page${page}.json`, 'utf8')) as { residents: Resident[] }))
  return pages.flatMap(page => page.residents)
}

async function openFixture(page: Page): Promise<{ external: string[]; errors: string[] }> {
  const diagnostics = await keepFixtureOffline(page)
  await page.goto(fixtureUrl)
  return diagnostics
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
  await page.clock.install({ time: Date.parse('2026-09-07T01:30:42.383Z') })
  const diagnostics = await openFixture(page); await waitUntilReady(page)
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '3')
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

test('pause holds an advancing scene, resume advances it, and pointer navigation does nothing', async ({ page }) => {
  const diagnostics = await openFixture(page); await waitUntilReady(page)
  const elapsed = () => page.evaluate(() => Number(document.body.dataset['liveElapsed']))
  const first = await elapsed()
  await expect.poll(elapsed).toBeGreaterThan(first)
  const pause = page.locator('#pause'); await pause.click()
  await expect(page.locator('body')).toHaveAttribute('data-live-paused', 'true')
  await expect(pause).toHaveAttribute('aria-label', 'Resume')
  const roomBefore = await page.locator('body').getAttribute('data-live-room')
  const frameBefore = await visibleFigures(page); const elapsedBefore = await elapsed()
  const box = await page.locator('#app canvas').boundingBox(); expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width * 0.4, box!.y + box!.height * 0.4); await page.mouse.down()
  await page.mouse.move(box!.x + box!.width * 0.65, box!.y + box!.height * 0.6, { steps: 4 }); await page.mouse.up(); await page.mouse.wheel(0, -180)
  await expect(page.locator('body')).toHaveAttribute('data-live-room', roomBefore!)
  await expect.poll(() => visibleFigures(page)).toEqual(frameBefore)
  await page.waitForTimeout(250)
  expect(await elapsed()).toBe(elapsedBefore)
  await pause.click()
  await expect(page.locator('body')).toHaveAttribute('data-live-paused', 'false')
  await expect.poll(elapsed).toBeGreaterThan(elapsedBefore)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('a tiny window reports its size honestly and redraws after each recovery', async ({ page }) => {
  await page.setViewportSize({ width: 136, height: 300 })
  const diagnostics = await openFixture(page)
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
  await expect(page.locator('#live-status')).toHaveText('This window is too small to draw the room.')
  await page.setViewportSize({ width: 375, height: 812 })
  await waitUntilReady(page)
  await expect(page.locator('#live-status')).toBeEmpty()
  await expect(page.locator('#app canvas')).toBeVisible()
  await expect.poll(() => visibleFigures(page)).not.toEqual([])
  const firstRevision = Number(await page.locator('body').getAttribute('data-live-layout-revision'))
  expect(firstRevision).toBeGreaterThan(0)
  await page.setViewportSize({ width: 136, height: 300 })
  await expect(page.locator('#live-status')).toHaveText('This window is too small to draw the room.')
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true')
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('#live-status')).toBeEmpty()
  await expect(page.locator('#app canvas')).toBeVisible()
  await expect.poll(() => visibleFigures(page)).not.toEqual([])
  await expect.poll(async () => Number(await page.locator('body').getAttribute('data-live-layout-revision'))).toBeGreaterThan(firstRevision)
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

test('a dense screen keeps canvas pixels sharp and residents at their CSS size', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  try {
    const diagnostics = await openFixture(page); await waitUntilReady(page)
    const canvas = page.locator('#app canvas')
    const box = await canvas.boundingBox(); expect(box).not.toBeNull()
    const backing = await canvas.evaluate(element => {
      const canvasElement = element as HTMLCanvasElement
      return { width: canvasElement.width, height: canvasElement.height }
    })
    expect(backing.width).toBe(Math.round(box!.width * 2))
    expect(backing.height).toBe(Math.round(box!.height * 2))
    const sizes = await page.evaluate(() => JSON.parse(document.body.dataset['liveFigureSizes'] ?? '[]') as Array<{ width: number; height: number }>)
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.every(size => size.width === 56 && size.height === 56)).toBe(true)
    expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
  } finally {
    await context.close()
  }
})
