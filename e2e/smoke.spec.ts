import { test, expect } from '@playwright/test'

// The one browser check version zero needs: the page draws the saved replay fixture and
// leaves a screenshot behind for humans. No live origin is called.
test('the live page draws the public record from a fixture', async ({ page }) => {
  await page.goto('/?replay=/fixtures/replay-24h.json')
  await expect.poll(() => page.evaluate(() => document.body.dataset['liveReady'] ?? ''), { timeout: 30_000 }).toBe('true')
  const status = await page.locator('#status').textContent()
  expect(status).toContain('places')
  expect(await page.locator('canvas').count()).toBeGreaterThan(0)
  await page.screenshot({ path: 'docs/screenshots/latest.png', fullPage: false })
})
