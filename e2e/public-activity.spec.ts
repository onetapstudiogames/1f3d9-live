import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { advanceToLivePoll, factsPlaces, json, keepFixtureOffline, liveFixtureUrl } from './live-fixture.ts'

type State = { resident?: string; room?: string; failure?: 'presence' | 'directory' | 'outline';
  quiet?: boolean; feed?: boolean; name?: string }
const places = [...factsPlaces, { ...factsPlaces[1]!, id: 310, name: 'resident room' }]

async function fixture(page: Page, state: () => State) {
  await page.clock.install({ time: Date.parse('2026-09-07T01:30:42.383Z') })
  await page.clock.pauseAt(Date.parse('2026-09-07T01:31:42.383Z'))
  const diagnostics = await keepFixtureOffline(page)
  const saved = JSON.parse(await readFile('public/fixtures/residents-presence-page1.json', 'utf8'))
  const resident = saved.residents.find((row: { id: number }) => row.id === 316)
  expect(resident).toBeDefined()
  const counts = { presence: 0, directory: 0, outline: 0, changes: 0 }
  await page.route('**/fixtures/residents-presence-page1.json', route => {
    counts.presence += 1
    return json(route, { residents: [{ ...resident, last_active: state().resident }], has_more: false },
      state().failure === 'presence' ? 503 : 200)
  })
  await page.route('**/fixtures/map-current-page1.json', route => {
    counts.directory += 1
    return json(route, { view: 'directory', places }, state().failure === 'directory' ? 503 : 200)
  })
  await page.route('**/fixtures/changes-live.json*', route => {
    counts.changes += 1
    return json(route, { change_marker: '100297', next_since: '100297', has_more: false, unchanged: true, changes: [] })
  })
  await page.route('**/fixtures/places/place-*.json*', route => {
    counts.outline += 1
    const id = Number(/place-(\d+)/.exec(route.request().url())![1])
    return json(route, { place: { ...places.find(row => row.id === id), labels: [], laws: [],
      ...(id === 310 ? { last_active: state().room, quiet: state().quiet ?? false,
        feed: state().feed ?? false, name: state().name ?? 'resident room' } : {}) },
    things: [], things_page: { total_items: 0, has_more: false } }, state().failure === 'outline' ? 503 : 200)
  })
  await page.goto(`${liveFixtureUrl}&place=310`)
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true')
  await page.clock.runFor(32)
  return { ...diagnostics, counts }
}

async function openResident(page: Page) {
  await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset['liveFigures'] ?? '[]').length)).toBe(1)
  const point = await page.evaluate(() => JSON.parse(document.body.dataset['liveFigures'] ?? '[]')[0] as { x: number; y: number })
  await page.locator('#app canvas').click({ position: point })
  await page.clock.runFor(32)
  await expect(page.locator('#item-panel')).toBeVisible()
  await page.locator('#room-facts > summary').focus()
  await page.keyboard.press('Enter')
  await page.clock.runFor(32)
}

async function hidden(page: Page, value: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value })
    document.dispatchEvent(new Event('visibilitychange'))
  }, value)
}

test('both open panels refresh all four bands with the unchanged marker and existing reads', async ({ page }) => {
  let state: State = { resident: 'active now', room: 'active now' }
  const diagnostics = await fixture(page, () => state)
  await openResident(page)
  for (const band of ['active now', 'today', 'this week', 'longer']) {
    if (band !== 'active now') {
      state = { resident: band, room: band }
      await advanceToLivePoll(page)
    }
    await expect(page.locator('#item-panel-facts')).toContainText(`Awake · ${band}`)
    await expect(page.locator('#room-last-active')).toHaveText(band)
  }
  expect(diagnostics.counts).toEqual({ presence: 4, directory: 4, outline: 4, changes: 3 })
  await expect(page.locator('body')).toHaveAttribute('data-live-delivered-marker', '100297')
  await expect(page.locator('#room-controls select')).toHaveCount(2)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('an older city and the off switch produce exactly the no-activity markup', async ({ page }) => {
  let state: State = {}
  const diagnostics = await fixture(page, () => state)
  await openResident(page)
  const noActivity = await page.locator('#item-panel-facts').innerHTML()
  const oldRoom = await page.locator('#room-facts-content').innerHTML()
  await expect(page.locator('#room-last-active')).toHaveCount(0)
  state = { resident: 'today', room: 'longer' }
  await advanceToLivePoll(page)
  await expect(page.locator('#item-panel-facts')).toContainText('Awake · today')
  await expect(page.locator('#room-last-active')).toHaveText('longer')
  // The public response for off omits the same field as unknown activity.
  state = {}
  await advanceToLivePoll(page)
  await expect(page.locator('#item-panel-facts')).toHaveText('Whereresident room · place #310StateAwake')
  expect(await page.locator('#item-panel-facts').innerHTML()).toBe(noActivity)
  expect(await page.locator('#room-facts-content').innerHTML()).toBe(oldRoom)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

for (const failure of ['presence', 'directory', 'outline'] as const) {
  test(`${failure} failure clears its bands and a fresh read restores them`, async ({ page }) => {
    let state: State = { resident: 'today', room: 'this week' }
    await fixture(page, () => state)
    await openResident(page)
    await expect(page.locator('#item-panel-facts')).toContainText('Awake · today')
    await expect(page.locator('#room-last-active')).toHaveText('this week')
    state = { ...state, failure }
    await advanceToLivePoll(page)
    await expect(page.locator('#room-last-active')).toHaveCount(0)
    if (failure !== 'outline') await expect(page.locator('#item-panel-facts')).not.toContainText('today')
    state = { resident: 'longer', room: 'longer' }
    await advanceToLivePoll(page)
    await expect(page.locator('#item-panel-facts')).toContainText('Awake · longer')
    await expect(page.locator('#room-last-active')).toHaveText('longer')
  })
}

test('hidden tabs clear open panels and reject a late previous refresh', async ({ page }) => {
  const diagnostics = await fixture(page, () => ({ resident: 'today', room: 'this week' }))
  await openResident(page)
  await expect(page.locator('#room-last-active')).toHaveText('this week')
  let requested = false
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/fixtures/places/place-310.json', async route => {
    requested = true
    await held
    await json(route, { place: { ...places[2], labels: [], laws: [], last_active: 'active now' },
      things: [], things_page: { total_items: 0, has_more: false } })
  })
  await advanceToLivePoll(page)
  await expect.poll(() => requested).toBe(true)
  await hidden(page, true)
  await expect(page.locator('#item-panel-facts')).not.toContainText('today')
  await expect(page.locator('#room-last-active')).toHaveCount(0)
  const response = page.waitForResponse('**/fixtures/places/place-310.json')
  release()
  await (await response).finished()
  await page.clock.runFor(32)
  await expect(page.locator('#room-last-active')).toHaveCount(0)
  await expect(page.locator('#item-panel-facts')).not.toContainText('today')
  await hidden(page, false)
  await expect(page.locator('#item-panel-facts')).toContainText('Awake · today')
  await expect(page.locator('#room-last-active')).toHaveText('active now')
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('selection clears room bands and a delayed old room cannot restore them', async ({ page }) => {
  await fixture(page, () => ({ resident: 'today', room: 'this week' }))
  await expect(page.locator('#room-last-active')).toHaveText('this week')
  let requested = false
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/fixtures/places/place-310.json', async route => {
    requested = true; await held
    await json(route, { place: { ...places[2], labels: [], laws: [], last_active: 'active now' },
      things: [], things_page: { total_items: 0, has_more: false } })
  })
  await advanceToLivePoll(page)
  await expect.poll(() => requested).toBe(true)
  await page.locator('#place-picker').selectOption('440')
  await page.clock.runFor(32)
  await expect(page.locator('#room-last-active')).toHaveCount(0)
  const response = page.waitForResponse('**/fixtures/places/place-310.json')
  release()
  await (await response).finished()
  await page.clock.runFor(32)
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '440')
  await expect(page.locator('#room-last-active')).toHaveCount(0)
})

for (const mode of ['quiet', 'feed', 'removed', 'muted'] as const) {
  test(`${mode} rooms clear an established band`, async ({ page }) => {
    let state: State = { resident: 'today', room: 'today' }
    await fixture(page, () => state)
    await openResident(page)
    await expect(page.locator('#room-last-active')).toHaveText('today')
    if (mode === 'muted') {
      await page.evaluate(() => {
        const key = '1f3d9:mutes:v1'
        localStorage.setItem(key, JSON.stringify({ version: 1, items: [{ type: 'place', id: 310, choice: 'mute' }] }))
        window.dispatchEvent(new StorageEvent('storage', { key }))
      })
    } else {
      state = { ...state, ...(mode === 'removed' ? { name: '[removed by maintainer]' } : { [mode]: true }) }
      await advanceToLivePoll(page)
    }
    await expect(page.locator('#room-last-active')).toHaveCount(0)
    if (mode !== 'feed') await expect(page.locator('#item-panel')).toBeHidden()
  })
}
