import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// The two rows in this fixture are the city's own: one recorded founding ("The Wrong Hat",
// place 782 under first town) and one recorded renaming (place 264). The window opens before
// the renaming and closes after the founding, so the page must hide the room that is not
// founded yet, swap the older plate when its row is due, and lay the walls in brick by brick.
test('the saved places fixture builds a founded room and swaps a renamed plate', async ({ page }) => {
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
  await page.goto('/?replay=/fixtures/replay-places.json&census=/fixtures/residents-presence-page1.json&drawings=/fixtures/drawings')
  await expect.poll(() => page.evaluate(() => document.body.dataset['liveReady'] ?? ''), { timeout: 30_000 }).toBe('true')
  // The unchanged renaming and founding rows are four recorded days apart, further than the
  // 300× box can cross inside the budget. Run the empty gap at a test-only speed; the minimum
  // holds still keep the brick build and the plate swap on screen.
  await page.locator('#speed').evaluate(select => {
    select.append(new Option('Test speed', '1000000'))
  })
  await page.locator('#speed').selectOption('1000000')
  // No assertion about when either arrives, only that the page drew both recorded moments.
  await expect.poll(() => page.evaluate(() => document.body.dataset['liveRenameShown'] ?? ''), { timeout: 30_000 }).toBe('true')
  await expect.poll(() => page.evaluate(() => document.body.dataset['liveFoundingShown'] ?? ''), { timeout: 30_000 }).toBe('true')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.locator('canvas')).toBeVisible()
  expect(external).toEqual([])
  expect(errors).toEqual([])
})
