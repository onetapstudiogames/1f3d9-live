import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// The saved rows in this fixture are the city's own: one recorded gift, and one recorded
// carried move. The gift names two residents the record never puts in the same room, so the
// page must say so instead of guessing a meeting; the carry has everything it needs and draws.
test('the saved handover fixture carries a thing and says what it could not show', async ({ page }) => {
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
  await page.goto('/?replay=/fixtures/replay-handovers.json&census=/fixtures/residents-presence-page1.json&drawings=/fixtures/drawings')
  await expect.poll(() => page.evaluate(() => document.body.dataset['liveReady'] ?? ''), { timeout: 30_000 }).toBe('true')
  // The recorded carry happens a recorded minute in, so the clock has to run first. There is
  // no assertion about when it arrives, only that the page drew it before the test gives up.
  await expect.poll(() => page.evaluate(() => document.body.dataset['liveHandoverShown'] ?? ''), { timeout: 30_000 }).toBe('true')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.locator('#status')).toContainText('Some recorded handovers could not be shown')
  await expect(page.locator('canvas')).toBeVisible()
  expect(external).toEqual([])
  expect(errors).toEqual([])
})
