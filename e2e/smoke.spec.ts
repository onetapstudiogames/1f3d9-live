import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('the fixture draws tiled floors, sleeper control, and both ways to follow', async ({ page }) => {
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
  await expect.poll(() => page.evaluate(() => document.body.dataset['livePlaceDrawing'] ?? ''), { timeout: 30_000 }).toBe('true')
  await expect(page.locator('body')).toHaveAttribute('data-live-place-floor', 'true')
  await expect.poll(() => page.evaluate(() => {
    const things = JSON.parse(document.body.dataset['liveThings'] ?? '[]') as { id: number; name: string | null }[]
    return things.find(thing => thing.id === 1536)?.name
  }), { timeout: 30_000 }).toBe('a single clock hand, the minute hand, pointing at 12')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-live-show-sleepers', 'false')
  await page.getByRole('checkbox', { name: 'Show sleepers' }).check()
  await expect(page.locator('body')).toHaveAttribute('data-live-show-sleepers', 'true')
  expect(await page.evaluate(() => localStorage.getItem('1f3d9-live-show-sleepers'))).toBe('true')
  await page.getByRole('checkbox', { name: 'Show sleepers' }).uncheck()
  await expect(page.locator('#status')).toContainText('735 places')
  await expect(page.locator('canvas')).toBeVisible()
  await page.screenshot({ path: 'docs/screenshots/latest.png', fullPage: false })
  await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset['liveFigures'] ?? '[]').length)).toBeGreaterThan(0)
  const [figure] = await page.evaluate(() => JSON.parse(document.body.dataset['liveFigures']!) as { id: number; x: number; y: number }[])
  expect(figure).toBeDefined()
  await page.mouse.click(figure!.x, figure!.y)
  await expect(page.locator('body')).toHaveAttribute('data-live-following', String(figure!.id))
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
  const firstChoice = await page.getByRole('listbox', { name: 'Choose resident' }).locator('option:not([value=""])').first().evaluate(option => ({
    value: (option as HTMLOptionElement).value, name: option.textContent ?? '',
  }))
  await page.getByRole('searchbox', { name: 'Find resident' }).fill(firstChoice.name.slice(0, 3))
  await page.getByRole('listbox', { name: 'Choose resident' }).selectOption(firstChoice.value)
  await expect(page.locator('body')).toHaveAttribute('data-live-following', firstChoice.value)
  await expect(page.locator('#view')).toContainText('Following')
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-live-following', '')
  await page.getByRole('checkbox', { name: 'Show sleepers' }).check()
  await page.getByRole('button', { name: 'Follow', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Find resident' }).fill('hi-its-me')
  await page.getByRole('listbox', { name: 'Choose resident' }).selectOption('244')
  await expect(page.locator('body')).toHaveAttribute('data-live-following', '244')
  await page.getByRole('checkbox', { name: 'Show sleepers' }).uncheck()
  await expect(page.locator('body')).toHaveAttribute('data-live-following', '')
  await expect(page.locator('#status')).toContainText('hi-its-me is hidden because sleepers are off.')
  expect(external).toEqual([])
  expect(errors).toEqual([])
})
