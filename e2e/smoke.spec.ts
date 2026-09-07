import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('the fixture draws, a figure follows, and empty floor releases the camera', async ({ page }) => {
  const external: string[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://localhost:4173') {
      external.push(url.href)
      await route.abort()
      return
    }
    const drawing = /^\/fixtures\/drawings\/resident-(\d+)\.json$/.exec(url.pathname)
    if (drawing) {
      // Missing saved art is a 404, not Vite's HTML fallback for unknown paths.
      try {
        const body = await readFile(`public/fixtures/drawings/resident-${drawing[1]}.json`, 'utf8')
        await route.fulfill({ contentType: 'application/json', body })
      } catch {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
      }
      return
    }
    await route.continue()
  })
  await page.goto('/?replay=/fixtures/replay-24h.json&census=/fixtures/residents-presence-page1.json&drawings=/fixtures/drawings')
  await expect.poll(() => page.evaluate(() => document.body.dataset['liveReady'] ?? ''), { timeout: 30_000 }).toBe('true')
  await expect(page.locator('body')).toHaveAttribute('data-live-place-drawing', 'true')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.locator('#status')).toContainText('735 places')
  await expect(page.locator('canvas')).toBeVisible()
  await page.screenshot({ path: 'docs/screenshots/latest.png', fullPage: false })
  await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset['liveFigures'] ?? '[]').length)).toBeGreaterThan(0)
  const [figure] = await page.evaluate(() => JSON.parse(document.body.dataset['liveFigures']!) as { id: number; x: number; y: number }[])
  expect(figure).toBeDefined()
  await page.mouse.click(figure!.x, figure!.y)
  await expect(page.locator('body')).toHaveAttribute('data-live-following', String(figure!.id))
  await expect(page.locator('#view')).toContainText('Following')
  // Search a clear point away from all rendered figures. No clock or movement assertion.
  const empty = await page.evaluate(() => {
    const figures = JSON.parse(document.body.dataset['liveFigures']!) as { x: number; y: number }[]
    for (let y = 230; y < 600; y += 45) {
      for (let x = 80; x < 1200; x += 45) {
        if (figures.every(figure => Math.hypot(figure.x - x, figure.y - y) > 45)) return { x, y }
      }
    }
    throw new Error('No empty floor point found')
  })
  await page.mouse.click(empty.x, empty.y)
  await expect(page.locator('body')).toHaveAttribute('data-live-following', '')
  expect(external).toEqual([])
  expect(errors).toEqual([])
})
