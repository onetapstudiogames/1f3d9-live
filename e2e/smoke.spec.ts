import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const fixtureUrl = '/?replay=/fixtures/replay-24h.json&census=/fixtures/residents-presence-page1.json&drawings=/fixtures/drawings&places=/fixtures/places'

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

test('viewer controls follow a resident and preserve the choice while browsing', async ({ page }) => {
  const diagnostics = await openFixture(page)
  const picker = page.locator('#follow-picker')
  await expect.poll(() => picker.locator('option:not([value=""])').count(), { timeout: 30_000 }).toBeGreaterThan(0)
  const resident = await picker.locator('option:not([value=""])').first().getAttribute('value')
  expect(resident).not.toBeNull()
  await picker.selectOption(resident!); await expect(page.locator('body')).toHaveAttribute('data-live-following', resident!)
  await waitUntilReady(page)
  await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset['liveFigures'] ?? '[]').length)).toBeGreaterThan(0)
  await expect(page.locator('body')).toHaveAttribute('data-live-paused', 'true')
  await expect(page.locator('#pause')).toHaveAttribute('aria-label', 'Pause')
  await expect(page.locator('#pause')).toHaveText('⏸')
  await expect(page.locator('#normal')).toHaveAttribute('aria-pressed', 'false')
  await page.locator('#normal').click(); await expect(page.locator('body')).toHaveAttribute('data-live-paused', 'false')
  await page.locator('#show-sleepers').check(); await expect(page.locator('body')).toHaveAttribute('data-live-show-sleepers', 'true')
  expect(await page.evaluate(() => localStorage.getItem('1f3d9-live-show-sleepers'))).toBe('true')
  const box = await page.locator('#app canvas').boundingBox(); expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 500, box!.y + 350); await page.mouse.down()
  await page.mouse.move(box!.x + 560, box!.y + 390, { steps: 4 }); await page.mouse.up(); await page.mouse.wheel(0, -180)
  await expect(page.locator('body')).toHaveAttribute('data-live-following', resident!)
  await expect(page.locator('body')).toHaveAttribute('data-live-follow-suspended', 'true')
  await page.locator('#minimap-toggle').click(); await expect(page.locator('#minimap-canvas')).toBeVisible()
  await page.locator('#minimap-canvas').click({ position: { x: 40, y: 40 } })
  await expect(page.locator('body')).toHaveAttribute('data-live-following', resident!); await expect(picker).toHaveValue(resident!)
  await expect(page.locator('#show-sleepers')).toBeChecked(); await page.locator('#follow-stop').click()
  await expect(page.locator('body')).toHaveAttribute('data-live-following', '')
  await page.locator('#pause').click(); await expect(page.locator('body')).toHaveAttribute('data-live-paused', 'true')
  await expect(page.locator('#pause')).toHaveText('⏸')
  await page.locator('#fast').click(); await expect(page.locator('body')).toHaveAttribute('data-live-speed', '60')
  await expect(page.locator('body')).toHaveAttribute('data-live-paused', 'false')
  const rewind = page.locator('#rewind'); await expect(rewind).toHaveAttribute('aria-label', 'Rewind')
  await expect(rewind).toBeEnabled(); await rewind.click()
  await expect(page.locator('body')).toHaveAttribute('data-live-direction', 'backward')
  await page.locator('#live-now').click()
  await expect.poll(() => page.evaluate(() => document.body.dataset['liveMode'] ?? ''), { timeout: 30_000 }).toBe('live')
  await page.locator('#replay-day').click(); await expect(page.locator('body')).toHaveAttribute('data-live-mode', 'replay')
  await expect(page.locator('#replay-day')).toHaveText('Replay')
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('activity controls filter portraits, collapse, and hide with the viewer UI', async ({ page }) => {
  const diagnostics = await openFixture(page); await waitUntilReady(page)
  const rows = page.locator('#activity-list .activity-row')
  await expect.poll(() => rows.count()).toBeGreaterThan(0)
  const allCount = await rows.count(); await expect(page.locator('#activity-list [role="img"]')).not.toHaveCount(0)
  await page.locator('#activity-filter').selectOption('chats'); await expect.poll(() => rows.count()).toBeLessThanOrEqual(allCount)
  await page.locator('#activity-toggle').click(); await expect(page.locator('#activity-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#activity-list')).toBeHidden(); await page.locator('#activity-toggle').click(); await expect(page.locator('#activity-list')).toBeVisible()
  await page.locator('#ui-toggle').click(); await expect(page.locator('#viewer-ui')).toBeHidden(); await expect(page.locator('#activity-panel')).toBeHidden()
  await expect(page.locator('#ui-toggle')).toBeVisible(); await page.getByRole('button', { name: 'Show controls', exact: true }).click()
  await expect(page.locator('#viewer-ui')).toBeVisible(); await expect(page.locator('#activity-panel')).toBeVisible()
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('phone touch pinch changes the minimap framing without page overflow', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP touch input is Chromium-only')
  await page.setViewportSize({ width: 390, height: 844 })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
  const diagnostics = await openFixture(page); await waitUntilReady(page)
  await page.locator('#minimap-toggle').click(); const minimap = page.locator('#minimap-canvas'); await expect(minimap).toBeVisible()
  const before = await minimap.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 145, y: 410, id: 1 }, { x: 245, y: 410, id: 2 }] })
  for (const spread of [15, 30, 40]) {
    await page.evaluate(() => new Promise(requestAnimationFrame))
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
      { x: 145 - spread, y: 410, id: 1 }, { x: 245 + spread, y: 410, id: 2 },
    ] })
  }
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => minimap.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())).not.toBe(before)
  await expect.poll(() => minimap.evaluate(canvas => {
    const element = canvas as HTMLCanvasElement
    return element.getContext('2d')?.getImageData(0, 0, element.width, element.height).data.some(value => value !== 0) ?? false
  })).toBe(true)
  expect(await page.evaluate(() => ({ horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight }))).toEqual({ horizontal: false, vertical: false })
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})
