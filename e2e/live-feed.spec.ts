import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const fixtureUrl = '/?replay=/fixtures/replay-24h.json&census=/fixtures/residents-presence-page1.json&drawings=/fixtures/drawings&places=/fixtures/places'
const fixtureOrigin = 'http://localhost:4173'

async function keepFixtureOffline(page: Page): Promise<{ external: string[]; errors: string[] }> {
  const external: string[] = []; const errors: string[] = []
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

test('a saved change arriving while startup reads are in flight is delivered', async ({ page }) => {
  const beforeChange = new Date('2026-09-07T15:07:20.000Z')
  const afterChange = new Date('2026-09-07T15:07:30.000Z')
  await page.clock.install({ time: beforeChange })
  const diagnostics = await keepFixtureOffline(page)
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
  await page.clock.setFixedTime(afterChange)
  releaseCensus()

  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  await expect(page.locator('body')).toHaveAttribute('data-live-delivered-marker', '100297', { timeout: 30_000 })
  await expect(page.locator('#room-activity')).toBeEmpty()
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})
