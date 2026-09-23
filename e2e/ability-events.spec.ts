import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { advanceToLivePoll, keepFixtureOffline, liveFixtureUrl } from './live-fixture.ts'

// Rows shaped from the city's own recorded ability events (city PRs #359 and #360), cut to
// the reference fields /api/changes keeps. See docs/CITY-API.md.
test('ability rows show as plain room-log lines and a rough room shows its mark', async ({ page }) => {
  test.setTimeout(120_000)
  await page.clock.install({ time: new Date('2026-09-07T13:53:04.254Z') })
  await page.clock.pauseAt(new Date('2026-09-07T13:54:06.000Z'))
  const diagnostics = await keepFixtureOffline(page)
  const outline = JSON.parse(await readFile('public/fixtures/places/place-3.json', 'utf8')) as { place: Record<string, unknown> }
  expect(outline.place['rough_room']).toBeUndefined()
  await page.route('**/fixtures/places/place-3.json', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ ...outline, place: { ...outline.place, rough_room: true } }) }))

  let releaseChange!: () => void
  let changeRequested = false
  const held = new Promise<void>(resolve => { releaseChange = resolve })
  const abilities = await readFile('public/fixtures/changes-abilities.json', 'utf8')
  await page.route('**/fixtures/changes-live.json', async route => {
    changeRequested = true
    await held
    await route.fulfill({ contentType: 'application/json', body: abilities })
  })

  await page.goto(liveFixtureUrl)
  await expect.poll(async () => {
    await page.clock.runFor(16)
    return await page.locator('body').getAttribute('data-live-ready')
  }, { timeout: 30_000 }).toBe('true')
  await page.locator('#place-picker').selectOption('3')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '3')
  const mark = page.locator('#room-mark')
  await expect.poll(async () => {
    await page.clock.runFor(100)
    return await mark.isVisible()
  }, { timeout: 30_000 }).toBe(true)
  await expect(mark).toHaveText('rough room')
  await expect(mark).toHaveAttribute('title', /Going home is never blocked\./)
  await expect(page.locator('#room-name')).toHaveText('the square')

  await advanceToLivePoll(page)
  await expect.poll(() => changeRequested).toBe(true)
  releaseChange()
  await expect(page.locator('body')).toHaveAttribute('data-live-poll', 'true')

  const log = page.locator('#room-activity')
  for (const words of ['northstar rolled a public chance with ', '; it hit.', '; it missed.',
    'northstar set off a public roll that picked which things wake in the square.',
    'northstar arrived and things woke in the square.', 'northstar checked in; the square settled and nothing woke.',
    'northstar changed the state box of ', 'made a copy', ' into another kind.', 'northstar left a public record (weather turned).']) {
    await expect(log).toContainText(words)
  }
  await expect(log).not.toContainText(/error|undefined|null/i)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])

  await page.locator('#place-picker').selectOption('97')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '97')
  await expect.poll(async () => {
    await page.clock.runFor(100)
    return await mark.isHidden()
  }, { timeout: 30_000 }).toBe(true)
})
