import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { advanceToLivePoll, keepFixtureOffline, liveFixtureUrl } from './live-fixture.ts'

// Rows shaped from city PR #368's own integration test, which adds the ability numbers to
// /api/changes. See docs/CITY-API.md.
test('ability rows with numbers show them in plain room-log words', async ({ page }) => {
  test.setTimeout(120_000)
  await page.clock.install({ time: new Date('2026-09-07T13:53:04.254Z') })
  await page.clock.pauseAt(new Date('2026-09-07T13:54:10.000Z'))
  const diagnostics = await keepFixtureOffline(page)

  let releaseChange!: () => void
  let changeRequested = false
  const held = new Promise<void>(resolve => { releaseChange = resolve })
  const details = await readFile('public/fixtures/changes-abilities-details.json', 'utf8')
  await page.route('**/fixtures/changes-live.json', async route => {
    changeRequested = true
    await held
    await route.fulfill({ contentType: 'application/json', body: details })
  })

  await page.goto(liveFixtureUrl)
  await expect.poll(async () => {
    await page.clock.runFor(16)
    return await page.locator('body').getAttribute('data-live-ready')
  }, { timeout: 30_000 }).toBe('true')
  await page.locator('#place-picker').selectOption('3')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '3')
  await expect.poll(async () => {
    await page.clock.runFor(100)
    return await page.locator('#room-name').textContent()
  }, { timeout: 30_000 }).toBe('the square')

  await advanceToLivePoll(page)
  await expect.poll(() => changeRequested).toBe(true)
  releaseChange()
  await expect(page.locator('body')).toHaveAttribute('data-live-poll', 'true')

  const log = page.locator('#room-activity')
  for (const words of [', a 50 percent chance, hit.', ', missed; the action failed, so it did not count.',
    'northstar rolled 3 of 8 to pick which things wake in the square.',
    'northstar arrived and things woke in the square: 8 tried, 8 woke.',
    'added to guests in the state box of ', ', version 12.', ', version 13.', 'made a copy: moss, generation 2.',
    'refused: room daily limit 3, over by 1.', 'reached 8 things, 1 refused.',
    "reached 1 resident, 2 more left out; the action's reach limit stopped it.",
    'from kind #66 into kind #67 by a law.', 'northstar left a public record (weather turned).']) {
    await expect(log).toContainText(words)
  }
  await expect(log).not.toContainText(/error|undefined|null|NaN/i)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})
