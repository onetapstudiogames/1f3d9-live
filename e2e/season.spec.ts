import { test, expect, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { keepFixtureOffline, liveFixtureUrl } from './live-fixture.ts'

const dressedUrl = `${liveFixtureUrl}&season=/fixtures/season.json`

async function ready(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.body.dataset['liveReady'] ?? ''), { timeout: 30_000 }).toBe('true')
}

function token(page: Page, name: string): Promise<string> {
  return page.evaluate(token => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name)
}

test('a dressed day shows the skyline icon, the slogan words and the season frame colors', async ({ page }) => {
  const diagnostics = await keepFixtureOffline(page)
  await page.goto(dressedUrl)
  await ready(page)
  await expect(page.locator('body')).toHaveAttribute('data-live-season', '2027-12-25')
  const icon = page.locator('#season-icon')
  await expect(icon).toBeVisible()
  await expect(icon).toHaveAttribute('alt', 'The 1F3D9 skyline, dressed for Hanukkah and Christmas')
  await expect(icon).toHaveAttribute('src', '/fixtures/season/icon.svg')
  await expect(page.locator('#season-slogan')).toBeVisible()
  await expect(page.locator('#season-slogan')).toHaveText('The and city where agents live')
  await expect(page.locator('#season-slogan img')).toHaveCount(2)
  expect(await page.locator('#season-slogan img').evaluateAll(images => images.map(image => (image as HTMLImageElement).alt)))
    .toEqual(['candlelit', 'jolly'])
  await expect.poll(() => page.locator('#season-slogan img').evaluateAll(images =>
    images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  expect(await token(page, '--frame')).toBe('#0f1d30')
  expect(await token(page, '--accent')).toBe('#f3d27a')
  await mkdir('docs/screenshots', { recursive: true })
  await page.screenshot({ path: 'docs/screenshots/season-fixture-desktop.png' })

  await page.setViewportSize({ width: 375, height: 812 })
  await expect(icon).toBeVisible()
  await expect(page.locator('#season-slogan')).toBeHidden()
  const header = await page.locator('#room-header').boundingBox()
  expect(header!.height).toBeLessThanOrEqual(60)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  await page.screenshot({ path: 'docs/screenshots/season-fixture-phone.png' })
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('a quiet day keeps the default frame with no icon or slogan', async ({ page }) => {
  const diagnostics = await keepFixtureOffline(page)
  const quiet = await readFile('test/fixtures/season-2027-10-11.json', 'utf8')
  await page.route(url => url.pathname === '/fixtures/season-quiet.json', route => route.fulfill({ contentType: 'application/json', body: quiet }))
  await page.goto(`${liveFixtureUrl}&season=/fixtures/season-quiet.json`)
  await ready(page)
  await expect(page.locator('body')).toHaveAttribute('data-live-season', '2027-10-11')
  await expect(page.locator('#season-icon')).toBeHidden()
  await expect(page.locator('#season-slogan')).toBeHidden()
  expect(await token(page, '--frame')).toBe('#202820')
  expect(await token(page, '--accent')).toBe('#e2c77b')
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})
