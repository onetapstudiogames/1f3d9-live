import { test, expect, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { advanceToLivePoll, json, keepFixtureOffline, liveFixtureUrl } from './live-fixture.ts'

const fixtureUrl = liveFixtureUrl
const removedControlIds = ['pause', 'rewind', 'normal', 'fast', 'live-now', 'replay-day', 'nearby', 'city', 'follow-stop', 'show-sleepers', 'minimap-toggle', 'minimap-canvas', 'ui-toggle', 'activity-panel', 'activity-filter', 'activity-toggle']
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

const factsLaw = { traitId: 478, name: 'shared condition', sourcePlaceId: 440, position: 0, recipe: null }
const factsPlaces = [
  { id: 440, name: 'source room', parent_id: null, owner: 'serein', owner_id: 223, quiet: false, has_drawing: false },
  { id: 1124, name: 'child room', parent_id: 440, owner: 'serein', owner_id: 223, quiet: false, has_drawing: false },
]
type FactsState = { labels?: readonly string[]; laws?: readonly typeof factsLaw[]; quiet?: boolean; name?: string; status?: number }

async function factsFixture(page: Page, state: () => FactsState = () => ({ labels: ['local-condition'], laws: [factsLaw] }),
  directory = () => factsPlaces) {
  await page.clock.install({ time: Date.parse('2026-09-07T01:30:42.383Z') })
  await page.clock.pauseAt(Date.parse('2026-09-07T01:31:42.383Z'))
  const diagnostics = await keepFixtureOffline(page)
  const reads: number[] = []
  await page.route('**/fixtures/map-current-page1.json', route => json(route, { view: 'directory', places: directory() }))
  await page.route('**/fixtures/changes-live.json*', route => json(route,
    { change_marker: '100297', next_since: '100297', has_more: false, unchanged: true, changes: [] }))
  await page.route('**/fixtures/places/place-*.json*', route => {
    const id = Number(/place-(\d+)/.exec(route.request().url())![1])
    reads.push(id)
    const facts = id === 1124 ? state() : { labels: ['shared-condition'], laws: [factsLaw] }
    const place = directory().find(row => row.id === id)
    return json(route, { place: { ...place, ...facts }, things: [], things_page: { total_items: 0, has_more: false } }, facts.status ?? 200)
  })
  await page.goto(`${fixtureUrl}&place=1124`)
  await waitUntilReady(page)
  return { ...diagnostics, reads }
}

async function openFacts(page: Page): Promise<void> {
  const summary = page.locator('#room-facts > summary')
  await expect(summary).toHaveText('Room facts')
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#room-facts')).toHaveAttribute('open', '')
}

test('room facts show local labels and keyboard links to the defining place', async ({ page }) => {
  const diagnostics = await factsFixture(page, () => ({ labels: ['local-condition', '<b>plain text</b>'], laws: [factsLaw] }))
  await openFacts(page)
  await expect(page.locator('#room-facts')).toContainText('Labels here')
  await expect(page.locator('#room-labels')).toHaveText('local-condition, <b>plain text</b>')
  await expect(page.locator('#room-labels b')).toHaveCount(0)
  await expect(page.locator('#room-labels')).not.toContainText('shared-condition')
  await expect(page.locator('#room-laws')).toContainText('shared condition')
  expect(diagnostics.reads).toEqual([1124])
  const link = page.getByRole('link', { name: 'source room (place #440)' })
  const href = new URL(await link.getAttribute('href') ?? '', page.url())
  expect(href.searchParams.get('place')).toBe('440')
  expect(href.searchParams.has('resident')).toBe(false)
  await link.focus()
  await page.clock.runFor(100)
  await expect(link).toBeFocused()
  await page.keyboard.press('Enter')
  await page.waitForURL(url => url.searchParams.get('place') === '440')
  await waitUntilReady(page)
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '440')
  await openFacts(page)
  await expect(page.locator('#room-labels')).toHaveText('shared-condition')
  expect(diagnostics.reads).toContain(440)
  await expect(page.locator('#room-controls > select')).toHaveCount(2)
  await expect(page.locator('#room-controls > *')).toHaveCount(2)
  await expect(page.locator('button:not(#item-panel-close), input')).toHaveCount(0)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('room facts replace expired and missing values without a changed event cursor', async ({ page }) => {
  let state: FactsState = { labels: ['local-condition'], laws: [factsLaw] }
  const diagnostics = await factsFixture(page, () => state)
  await openFacts(page)
  await expect(page.locator('#room-labels')).toHaveText('local-condition')
  state = { labels: [], laws: [] }
  await advanceToLivePoll(page)
  await expect(page.locator('#room-labels')).toHaveText('None.')
  await expect(page.locator('#room-laws')).toHaveText('None.')
  await expect(page.locator('body')).toHaveAttribute('data-live-delivered-marker', '100297')
  state = {}
  await advanceToLivePoll(page)
  await expect(page.locator('#room-labels')).toHaveText('Unavailable.')
  await expect(page.locator('#room-laws')).toHaveText('Unavailable.')
  expect(diagnostics.reads).toEqual([1124, 1124, 1124])
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('room facts clear after a failed focused read and recover on the existing poll', async ({ page }) => {
  let state: FactsState = { labels: ['local-condition'], laws: [factsLaw] }
  const diagnostics = await factsFixture(page, () => state)
  await openFacts(page)
  await expect(page.locator('#room-labels')).toHaveText('local-condition')
  state = { status: 503 }
  await advanceToLivePoll(page)
  await expect(page.locator('#room-labels')).toHaveText('Unavailable.')
  await expect(page.locator('#room-laws a')).toHaveCount(0)
  await expect(page.locator('#live-status')).not.toBeEmpty()
  state = { labels: ['fresh-condition'], laws: [factsLaw] }
  await advanceToLivePoll(page)
  await expect(page.locator('#room-labels')).toHaveText('fresh-condition')
  await expect(page.locator('#room-laws a')).toHaveCount(1)
  await expect(page.locator('#live-status')).toBeEmpty()
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

for (const hidden of ['quiet', 'mute', 'moderation'] as const) {
  test(`room facts clear when the selected room becomes ${hidden}`, async ({ page }) => {
    let state: FactsState = { labels: ['local-condition'], laws: [factsLaw] }
    const diagnostics = await factsFixture(page, () => state)
    await openFacts(page)
    await expect(page.locator('#room-labels')).toHaveText('local-condition')
    if (hidden === 'mute') {
      await page.evaluate(() => {
        const key = '1f3d9:mutes:v1'
        localStorage.setItem(key, JSON.stringify({ version: 1, items: [{ type: 'place', id: 1124, choice: 'mute' }] }))
        window.dispatchEvent(new StorageEvent('storage', { key }))
      })
    } else {
      state = { ...state, ...(hidden === 'quiet' ? { quiet: true } : { name: '[removed by maintainer]' }) }
      await advanceToLivePoll(page)
    }
    await expect(page.locator('#room-labels')).toHaveText('Unavailable.')
    await expect(page.locator('#room-laws')).toHaveText('Unavailable.')
    await expect(page.locator('#room-facts')).not.toContainText('local-condition')
    await expect(page.locator('#room-facts a')).toHaveCount(0)
    await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
    expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
  })
}

test('room facts drop hidden sources and replace a removed law name without extra reads', async ({ page }) => {
  let state: FactsState = { labels: ['local-condition'], laws: [factsLaw] }
  let places = factsPlaces
  const diagnostics = await factsFixture(page, () => state, () => places)
  await openFacts(page)
  await expect(page.locator('#room-laws')).toContainText('shared condition')
  state = { ...state, laws: [{ ...factsLaw, name: '[removed by maintainer]' }] }
  await advanceToLivePoll(page)
  await expect(page.locator('#room-laws')).not.toContainText('shared condition')
  await expect(page.locator('#room-laws a')).toHaveCount(0)
  state = { ...state, laws: [factsLaw] }
  places = factsPlaces.map(place => place.id === 440 ? { ...place, name: '[removed by maintainer]' } : place)
  await advanceToLivePoll(page)
  await expect(page.locator('#room-laws')).not.toContainText('shared condition')
  await expect(page.locator('#room-laws a')).toHaveCount(0)
  expect(diagnostics.reads.every(id => id === 1124)).toBe(true)
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('room facts respect a muted source and a quiet ancestor without reading either', async ({ page }) => {
  let places = factsPlaces
  const diagnostics = await factsFixture(page, undefined, () => places)
  await openFacts(page)
  await expect(page.locator('#room-laws a')).toHaveCount(1)
  await page.evaluate(() => {
    const key = '1f3d9:mutes:v1'
    localStorage.setItem(key, JSON.stringify({ version: 1, items: [
      { type: 'place', id: 440, choice: 'mute' }, { type: 'place', id: 1124, choice: 'allow' },
    ] }))
    window.dispatchEvent(new StorageEvent('storage', { key }))
  })
  await expect(page.locator('#room-labels')).toHaveText('local-condition')
  await expect(page.locator('#room-laws')).toHaveText('Defining place unavailable.')
  await expect(page.locator('#room-laws a')).toHaveCount(0)
  places = factsPlaces.map(place => place.id === 440 ? { ...place, quiet: true } : place)
  await advanceToLivePoll(page)
  await expect(page.locator('#room-labels')).toHaveText('Unavailable.')
  await expect(page.locator('#room-laws')).toHaveText('Unavailable.')
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
  expect(diagnostics.reads).toEqual([1124])
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('opens live in the busiest room with only the one-room controls', async ({ page }) => {
  await page.clock.install({ time: Date.parse('2026-09-07T01:30:42.383Z') })
  const diagnostics = await openFixture(page); await waitUntilReady(page)
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '3')
  await expect(page.locator('#room-controls > select')).toHaveCount(2)
  await expect(page.locator('#room-controls > *')).toHaveCount(2)
  await expect(page.locator('#item-panel')).toBeHidden()
  await expect(page.locator('#item-panel-close')).toHaveCount(1)
  await expect(page.locator('button:not(#item-panel-close), input')).toHaveCount(0)
  await expect(page.locator('#follow-picker')).toHaveAttribute('aria-label', 'Choose resident')
  await expect(page.locator('#place-picker')).toHaveAttribute('aria-label', 'Choose place')
  // Every choice names its resident or place and its number, as the owner asked (2026-09-09).
  const labels = await page.locator('#follow-picker option:not([value=""]), #place-picker option:not([value=""])')
    .evaluateAll(options => options.map(option => ({
      value: (option as HTMLOptionElement).value, text: option.textContent ?? '', pickerId: (option as HTMLOptionElement).closest('select')!.id })))
  expect(labels.length).toBeGreaterThan(1)
  for (const { value, text, pickerId } of labels) {
    const kind = pickerId === 'follow-picker' ? 'resident' : 'place'
    expect(text.endsWith(` · ${kind} #${value}`), `${pickerId} option ${text}`).toBe(true)
    expect(text.length).toBeGreaterThan(` · ${kind} #${value}`.length)
  }
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
  const diagnostics = await factsFixture(page, () => ({
    labels: Array.from({ length: 40 }, (_, index) => `condition-${index}-${'long'.repeat(30)}`),
    laws: Array.from({ length: 20 }, (_, index) => ({ ...factsLaw, traitId: 478 + index, name: `law-${index}` })),
  }))
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
  await openFacts(page)
  await page.clock.runFor(100)
  const openApp = await page.locator('#app').boundingBox()
  const facts = await page.locator('#room-facts-content').boundingBox()
  expect(openApp!.height).toBeGreaterThan(400)
  expect(facts!.height).toBeLessThanOrEqual(160)
  expect(await page.locator('header').boundingBox()).toEqual(header)
  await page.locator('#room-facts-content').focus()
  await page.keyboard.press('End')
  await expect.poll(() => page.locator('#room-facts-content').evaluate(node => node.scrollTop)).toBeGreaterThan(0)
  await expect(page.locator('#room-controls > select')).toHaveCount(2)
  for (const id of ['follow-picker', 'place-picker']) await expect(page.locator(`#${id}`)).toBeInViewport()
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
