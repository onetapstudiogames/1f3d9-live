import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const fixtureUrl = '/?replay=/fixtures/replay-24h.json&census=/fixtures/residents-presence-page1.json&drawings=/fixtures/drawings&places=/fixtures/places'

async function repeatRecordedChange(page: Page): Promise<{ repeated: Promise<void> }> {
  const source = JSON.parse(await readFile('public/fixtures/changes-live.json', 'utf8')) as {
    changes: Array<{ change_id: string }>
  }
  const change = source.changes.find(row => row.change_id === '100297')
  if (!change) throw new Error('The fixture is missing recorded change 100297.')
  let reads = 0; let secondRead!: () => void
  const repeated = new Promise<void>(resolve => { secondRead = resolve })
  await page.route('**/fixtures/changes-live.json', async route => {
    reads += 1
    const firstPage = reads === 1
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      change_marker: '100298', changes: [change], returned_items: 1, unchanged: false,
      has_more: firstPage, next_since: firstPage ? '100297' : '100298',
    }) })
    if (reads === 2) secondRead()
  })
  return { repeated }
}

async function expectDeliveredOnce(page: Page, repeated: Promise<void>): Promise<void> {
  await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset['liveDeliveryCounts'] ?? '{}')['100297'] ?? 0),
    { timeout: 30_000 }).toBe(1)
  await repeated
  await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset['liveDeliveryCounts'] ?? '{}')['100297'] ?? 0)).toBe(1)
}

async function keepFixtureOffline(page: Page): Promise<{ external: string[]; errors: string[] }> {
  const external: string[] = []; const errors: string[] = []
  const fixtureOrigin = new URL(test.info().project.use.baseURL!).origin
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== fixtureOrigin) { external.push(url.href); await route.abort(); return }
    const drawing = /^\/fixtures\/drawings\/resident-(\d+)\.json$/.exec(url.pathname)
    if (!drawing) { await route.continue(); return }
    try { await route.fulfill({ contentType: 'application/json', body: await readFile(`public/fixtures/drawings/resident-${drawing[1]}.json`, 'utf8') }) }
    catch { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }) }
  })
  return { external, errors }
}

test('a transient initial census failure retries the whole startup read', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-07T15:08:00.000Z') })
  const diagnostics = await keepFixtureOffline(page)
  let firstPageReads = 0
  await page.route('**/fixtures/residents-presence-page1.json', async route => {
    firstPageReads += 1
    if (firstPageReads === 1) { await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); return }
    await route.continue()
  })

  await page.goto(fixtureUrl)
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'error')
  await expect(page.locator('#follow-picker')).toBeDisabled()
  await expect(page.locator('#place-picker')).toBeDisabled()
  await expect(page.locator('#pause')).toBeDisabled()

  await page.clock.fastForward(30_001)
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  expect(firstPageReads).toBe(2)
  await expect(page.locator('#follow-picker')).toBeEnabled()
  await expect(page.locator('#place-picker')).toBeEnabled()
  await expect(page.locator('#pause')).toBeEnabled()
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('a change beyond the replay checkpoint is delivered once after a held census', async ({ page }) => {
  const diagnostics = await keepFixtureOffline(page)
  const { repeated } = await repeatRecordedChange(page)
  let releaseCensus!: () => void
  let censusRequested!: () => void
  const held = new Promise<void>(resolve => { releaseCensus = resolve })
  const requested = new Promise<void>(resolve => { censusRequested = resolve })
  await page.route('**/fixtures/residents-presence-page1.json', async route => {
    censusRequested()
    await held
    await route.fulfill({ contentType: 'application/json', body: await readFile('public/fixtures/residents-presence-page1.json', 'utf8') })
  })

  await page.goto(fixtureUrl)
  await requested
  releaseCensus()

  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  await expectDeliveredOnce(page, repeated)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('a change beyond the replay checkpoint is delivered once after a held replay', async ({ page }) => {
  const diagnostics = await keepFixtureOffline(page)
  const { repeated } = await repeatRecordedChange(page)
  let releaseReplay!: () => void
  let replayRequested!: () => void
  const held = new Promise<void>(resolve => { releaseReplay = resolve })
  const requested = new Promise<void>(resolve => { replayRequested = resolve })
  await page.route('**/fixtures/replay-24h.json', async route => {
    replayRequested()
    await held
    await route.fulfill({ contentType: 'application/json', body: await readFile('public/fixtures/replay-24h.json', 'utf8') })
  })

  const censusResponse = page.waitForResponse(response =>
    response.url().endsWith('/fixtures/residents-presence-page2.json') && response.ok())
  await page.goto(fixtureUrl)
  await requested
  await (await censusResponse).finished()
  await page.evaluate(async () => { await Promise.resolve(); await Promise.resolve() })
  releaseReplay()

  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  await expectDeliveredOnce(page, repeated)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})
