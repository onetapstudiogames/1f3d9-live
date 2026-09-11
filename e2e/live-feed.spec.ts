import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { advanceToLivePoll, fixtureDirectory, json, liveFixtureUrl } from './live-fixture.ts'

type Change = { change_id: string; kind: string; actor: string; detail: Record<string, unknown>; created_at: string }

async function witnessedChange(): Promise<Change> {
  const source = JSON.parse(await readFile('public/fixtures/changes-live.json', 'utf8')) as { changes: Change[] }
  const row = source.changes.find(change => change.change_id === '100297')
  if (!row) throw new Error('The fixture is missing recorded change 100297.')
  return row
}

async function installBase(page: Page, cursorBody: unknown | (() => unknown) = { change_marker: '100297' }) {
  const external: string[] = []; const errors: string[] = []; const requests: string[] = []
  const fixtureOrigin = new URL(test.info().project.use.baseURL!).origin
  const directory = await fixtureDirectory()
  let censusReads = 0; let mapReads = 0
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    requests.push(`${url.pathname}${url.search}`)
    if (url.origin !== fixtureOrigin) { external.push(url.href); await route.abort(); return }
    if (url.pathname === '/fixtures/map-current-page1.json') { mapReads += 1; await json(route, directory); return }
    if (url.pathname === '/fixtures/change-cursor.json') {
      await json(route, typeof cursorBody === 'function' ? cursorBody() : cursorBody); return
    }
    if (url.pathname === '/fixtures/places/place-518.json') {
      await json(route, { view: 'outline', place: { id: 518, name: 'the arrivals room', parent_id: 517,
        owner: 'waypost', owner_id: 273, quiet: false, laws: [] }, things: [],
        things_page: { total_items: 0, has_more: false } }); return
    }
    if (url.pathname === '/fixtures/notes/note-13273.json') {
      await json(route, { note: { id: 13273, author: 'halfverse', place_id: 518, body: 'newly witnessed words' } }); return
    }
    if (url.pathname === '/fixtures/residents-presence-page1.json') censusReads += 1
    const drawing = /^\/fixtures\/drawings\/resident-(\d+)\.json$/.exec(url.pathname)
    if (!drawing) { await route.continue(); return }
    try { await route.fulfill({ contentType: 'application/json', body: await readFile(`public/fixtures/drawings/resident-${drawing[1]}.json`, 'utf8') }) }
    catch { await json(route, {}, 404) }
  })
  return { external, errors, requests, censusReads: () => censusReads, mapReads: () => mapReads }
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
}

function emptyFeed(route: Route, marker = '100297'): Promise<void> {
  return json(route, { change_marker: marker, next_since: marker, has_more: false, unchanged: true, returned_items: 0, changes: [] })
}

test('startup takes the cursor head before current census and opens with an empty witnessed log', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-08T12:00:00.000Z') })
  const diagnostics = await installBase(page, { change_marker: '100297', changes: [{ change_id: '1', kind: 'note',
    actor: 'old-voice', detail: { note_id: 1, place_id: 8 }, created_at: '2020-01-01T00:00:00.000Z', line: 'old words must stay absent' }] })
  let feedReads = 0
  await page.route('**/fixtures/changes-live.json', route => { feedReads += 1; return emptyFeed(route) })
  await page.goto(liveFixtureUrl)
  await ready(page)
  expect(feedReads).toBe(0)
  await expect(page.locator('#room-activity')).not.toContainText('old words must stay absent')
  await expect(page.locator('#room-activity')).toBeEmpty()
  expect(diagnostics.requests.some(url => url.includes('replay') || /\/note(?:s)?\//.test(url))).toBe(false)
  expect(diagnostics.requests.indexOf('/fixtures/change-cursor.json'))
    .toBeLessThan(diagnostics.requests.indexOf('/fixtures/residents-presence-page1.json'))
  expect(diagnostics.censusReads()).toBeGreaterThan(0); expect(diagnostics.mapReads()).toBe(1)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('a newly witnessed change is delivered once and a successful read repaints current state', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-08T12:00:00.000Z') })
  const diagnostics = await installBase(page, { change_marker: '100296' }); const change = await witnessedChange()
  let feedReads = 0
  await page.route('**/fixtures/changes-live.json', route => {
    feedReads += 1
    return json(route, { change_marker: '100297', next_since: '100297', has_more: false, unchanged: false, returned_items: 1, changes: [change] })
  })
  await page.goto(liveFixtureUrl)
  await ready(page)
  await page.locator('#place-picker').selectOption('518')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '518')
  const initialRevision = Number(await page.locator('body').getAttribute('data-live-layout-revision'))
  await advanceToLivePoll(page)
  await expect.poll(() => feedReads).toBeGreaterThanOrEqual(1)
  await expect(page.locator('body')).toHaveAttribute('data-live-poll', 'true')
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
  await page.clock.runFor(16)
  await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset['liveDeliveryCounts'] ?? '{}')['100297'] ?? 0)).toBe(1)
  await expect.poll(async () => Number(await page.locator('body').getAttribute('data-live-layout-revision'))).toBeGreaterThan(initialRevision)
  expect(diagnostics.censusReads()).toBeGreaterThanOrEqual(2); expect(diagnostics.mapReads()).toBeGreaterThanOrEqual(2)
  await advanceToLivePoll(page)
  await expect.poll(() => feedReads).toBeGreaterThanOrEqual(2)
  expect(await page.evaluate(() => JSON.parse(document.body.dataset['liveDeliveryCounts'] ?? '{}')['100297'] ?? 0)).toBe(1)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('a note completed while hidden stays logged but its queued visual is discarded on return', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-08T12:00:00.000Z') })
  await page.addInitScript(() => {
    let fixtureHidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => fixtureHidden })
    Object.defineProperty(document, 'visibilityState', { configurable: true,
      get: () => fixtureHidden ? 'hidden' : 'visible' })
    Object.defineProperty(window, '__setFixtureHidden', { value: (hidden: boolean, notify = true) => {
      fixtureHidden = hidden
      if (notify) document.dispatchEvent(new Event('visibilitychange'))
    } })
  })
  let headMarker = '100296'
  const diagnostics = await installBase(page, () => ({ change_marker: headMarker })); const change = await witnessedChange()
  let feedReads = 0
  let releaseNote!: () => void
  const heldNote = new Promise<void>(resolve => { releaseNote = resolve })
  let noteRequested!: () => void
  const requestedNote = new Promise<void>(resolve => { noteRequested = resolve })
  await page.route('**/fixtures/changes-live.json', route => {
    feedReads += 1
    return json(route, { change_marker: '100297', next_since: '100297', has_more: false, unchanged: false,
      returned_items: 1, changes: [change] })
  })
  await page.route('**/fixtures/notes/note-13273.json', async route => {
    noteRequested()
    await heldNote
    await json(route, { note: { id: 13273, author: 'halfverse', place_id: 518, body: 'newly witnessed words' } })
  })
  await page.goto(liveFixtureUrl)
  await ready(page)
  await page.locator('#place-picker').selectOption('518')

  await advanceToLivePoll(page)
  await expect.poll(() => feedReads).toBeGreaterThanOrEqual(1)
  await requestedNote
  await page.evaluate(() => (window as typeof window & {
    __setFixtureHidden(hidden: boolean, notify?: boolean): void
  }).__setFixtureHidden(true, false))
  releaseNote()
  await expect(page.locator('#room-activity')).toContainText('newly witnessed words')
  await expect(page.locator('.room-speech-card[data-note-id="13273"]')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(document.body.dataset['liveDeliveryCounts'] ?? '{}')['100297'] ?? 0)).toBe(0)

  const hiddenRevision = Number(await page.locator('body').getAttribute('data-live-layout-revision'))
  const hiddenCensusReads = diagnostics.censusReads()
  const hiddenHeadReads = diagnostics.requests.filter(request => request === '/fixtures/change-cursor.json').length
  headMarker = '100297'
  await page.evaluate(() => (window as typeof window & { __setFixtureHidden(hidden: boolean): void }).__setFixtureHidden(true))
  await page.evaluate(() => (window as typeof window & { __setFixtureHidden(hidden: boolean): void }).__setFixtureHidden(false))
  await expect.poll(() => diagnostics.requests.filter(request => request === '/fixtures/change-cursor.json').length)
    .toBeGreaterThan(hiddenHeadReads)
  await expect.poll(() => diagnostics.censusReads()).toBeGreaterThan(hiddenCensusReads)
  await expect.poll(async () => Number(await page.locator('body').getAttribute('data-live-layout-revision')))
    .toBeGreaterThan(hiddenRevision)
  await expect(page.locator('.room-speech-card[data-note-id="13273"]')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(document.body.dataset['liveDeliveryCounts'] ?? '{}')['100297'] ?? 0)).toBe(0)
  await expect(page.locator('#room-activity')).toContainText('newly witnessed words')

  await advanceToLivePoll(page)
  await expect.poll(() => feedReads).toBeGreaterThanOrEqual(2)
  await expect(page.locator('.room-speech-card[data-note-id="13273"]')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(document.body.dataset['liveDeliveryCounts'] ?? '{}')['100297'] ?? 0)).toBe(0)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('a failed live read freezes the picture and recovers with one full repaint', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-08T12:00:00.000Z') })
  const diagnostics = await installBase(page); let feedReads = 0
  await page.route('**/fixtures/changes-live.json', async route => {
    feedReads += 1
    if (feedReads === 1) { await json(route, {}, 503); return }
    await emptyFeed(route)
  })
  await page.goto(liveFixtureUrl)
  await ready(page)
  const stableSize = await page.evaluate(() => ({ app: document.querySelector('#app')?.clientHeight,
    canvas: document.querySelector('canvas')?.clientHeight }))
  await advanceToLivePoll(page)
  await expect.poll(() => feedReads).toBe(1)
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'true')
  await expect(page.locator('#live-status')).not.toBeEmpty()
  expect(await page.evaluate(() => ({ app: document.querySelector('#app')?.clientHeight,
    canvas: document.querySelector('canvas')?.clientHeight }))).toEqual(stableSize)
  const frozen = await page.evaluate(() => ({ figures: document.body.dataset['liveFigures'],
    elapsed: document.body.dataset['liveElapsed'], revision: Number(document.body.dataset['liveLayoutRevision']) }))
  await page.clock.fastForward(500)
  expect(await page.evaluate(() => ({ figures: document.body.dataset['liveFigures'], elapsed: document.body.dataset['liveElapsed'] })))
    .toEqual({ figures: frozen.figures, elapsed: frozen.elapsed })
  await advanceToLivePoll(page)
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
  await expect(page.locator('#live-status')).toBeEmpty()
  await expect.poll(async () => Number(await page.locator('body').getAttribute('data-live-layout-revision'))).toBeGreaterThan(frozen.revision)
  expect(diagnostics.censusReads()).toBeGreaterThanOrEqual(2); expect(diagnostics.mapReads()).toBeGreaterThanOrEqual(2)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})
