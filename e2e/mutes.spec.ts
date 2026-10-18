import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { json, keepFixtureOffline, liveFixtureUrl } from './live-fixture.ts'

// The page reads the list the city's window saves in this browser; these checks write it
// themselves, before the page loads or with the storage event another tab would send.
const KEY = '1f3d9:mutes:v1'
const COUNT_WORDS = 'hidden by your mutes in this browser'
type Item = { type: string; id: number; choice: 'mute' | 'allow' }

async function storeBeforeLoad(page: Page, items: Item[]): Promise<void> {
  await page.addInitScript(([key, value]) => { window.localStorage.setItem(key!, value!) },
    [KEY, JSON.stringify({ version: 1, items })])
}

async function storeAndAnnounce(page: Page, items: Item[] | null): Promise<void> {
  await page.evaluate(([key, value]) => {
    if (value === null) window.localStorage.removeItem(key!)
    else window.localStorage.setItem(key!, value)
    window.dispatchEvent(new StorageEvent('storage', { key }))
  }, [KEY, items === null ? null : JSON.stringify({ version: 1, items })] as const)
}

async function figureIds(page: Page): Promise<number[]> {
  return page.evaluate(() => (JSON.parse(document.body.dataset['liveFigures'] ?? '[]') as { id: number }[])
    .map(row => row.id).sort((left, right) => left - right))
}

async function thingIds(page: Page): Promise<number[]> {
  return page.evaluate(() => (JSON.parse(document.body.dataset['liveThings'] ?? '[]') as { id: number }[]).map(row => row.id))
}

async function openRoom(page: Page, url: string, roomId: string): Promise<void> {
  await page.goto(url)
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  await page.locator('#place-picker').selectOption(roomId)
  await expect(page.locator('body')).toHaveAttribute('data-live-room', roomId)
}

test('a muted resident is not drawn, their line card never shows, and the status counts them', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-07T13:53:04.254Z') })
  await page.clock.pauseAt(new Date('2026-09-07T13:54:04.254Z'))
  await storeBeforeLoad(page, [{ type: 'resident', id: 302, choice: 'mute' }])
  const diagnostics = await keepFixtureOffline(page)
  const requests: string[] = []
  page.on('request', request => requests.push(new URL(request.url()).pathname))
  let talkReads = 0
  await page.route('**/fixtures/talk-now-line.json', async route => {
    talkReads += 1
    const head = JSON.parse(await readFile('public/fixtures/talk-now-line.json', 'utf8')) as Record<string, unknown>
    if (talkReads === 1) head['line_marker'] = '100297'
    await json(route, head)
  })
  await openRoom(page, `${liveFixtureUrl}&talk=/fixtures/talk-now-line.json&roomlines=/fixtures/room-lines`, '731')

  // Step until the check has read the new line (marker 100299 after the 100297 start).
  await expect.poll(async () => {
    if (await page.locator('body').getAttribute('data-live-talk-marker') === '100299') return 'read'
    await page.clock.fastForward(1_000)
    await page.clock.runFor(32)
    return await page.locator('body').getAttribute('data-live-talk-marker')
  }, { timeout: 30_000, intervals: [10] }).toBe('read')
  expect(requests).toContain('/fixtures/room-lines/lines-731-100299.json')
  await page.clock.runFor(500)

  await expect(page.locator('.room-speech-card[data-kind="line"]')).toHaveCount(0)
  await expect(page.locator('#room-activity')).not.toContainText('A line from the talk fixture.')
  await expect(page.locator('body')).toHaveAttribute('data-live-listening', '')
  const figures = await figureIds(page)
  expect(figures).not.toContain(302)
  expect(figures).toEqual(expect.arrayContaining([301, 303]))
  await expect(page.locator('#live-status')).toContainText(`1 ${COUNT_WORDS}.`)
  // The follow picker does not offer the muted resident, so its name is nowhere on the page.
  await expect(page.locator('#follow-picker option[value="301"]')).toHaveCount(1)
  await expect(page.locator('#follow-picker option[value="302"]')).toHaveCount(0)
  expect(await page.content()).not.toContain('buzz')
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('a thing by a muted maker is not drawn and is counted', async ({ page }) => {
  await storeBeforeLoad(page, [{ type: 'resident', id: 164, choice: 'mute' }])
  const diagnostics = await keepFixtureOffline(page)
  await openRoom(page, liveFixtureUrl, '767')
  // The count appears once the room's outline is merged and its thing is known to be hidden.
  await expect(page.locator('#live-status')).toContainText(`1 ${COUNT_WORDS}.`, { timeout: 30_000 })
  expect(await thingIds(page)).not.toContain(2803)
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('a storage event from another tab changes the picture without a reload', async ({ page }) => {
  const diagnostics = await keepFixtureOffline(page)
  await openRoom(page, liveFixtureUrl, '731')
  await expect.poll(() => figureIds(page), { timeout: 30_000 }).toEqual([301, 302, 303])
  await expect(page.locator('#live-status')).not.toContainText(COUNT_WORDS)

  await storeAndAnnounce(page, [{ type: 'resident', id: 302, choice: 'mute' }])
  await expect.poll(() => figureIds(page)).toEqual([301, 303])
  await expect(page.locator('#live-status')).toContainText(`1 ${COUNT_WORDS}.`)

  await storeAndAnnounce(page, [{ type: 'place', id: 731, choice: 'mute' }])
  await expect.poll(() => figureIds(page)).toEqual([])
  // Its three residents and the room's own drawing (The Hive is not the founder's).
  await expect(page.locator('#live-status')).toContainText(`4 ${COUNT_WORDS}.`)
  await expect(page.locator('#room-name')).not.toBeEmpty()
  await expect(page.locator('#follow-picker option[value="301"]')).toHaveCount(0)

  await storeAndAnnounce(page, null)
  await expect.poll(() => figureIds(page)).toEqual([301, 302, 303])
  await expect(page.locator('#live-status')).not.toContainText(COUNT_WORDS)
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('both founders stay in a muted place, even when a founder owns it, and only the others are hidden', async ({ page }) => {
  const diagnostics = await keepFixtureOffline(page)
  await openRoom(page, liveFixtureUrl, '3')
  await expect.poll(() => figureIds(page), { timeout: 30_000 }).toEqual(expect.arrayContaining([1, 2, 135, 186]))
  const others = (await figureIds(page)).filter(id => id !== 1 && id !== 2).length

  for (const place of [3, 2]) {
    await storeAndAnnounce(page, [{ type: 'place', id: place, choice: 'mute' }])
    await expect.poll(() => figureIds(page)).toEqual([1, 2])
    // Everyone else here is counted, with any of their things the list hides.
    await expect.poll(async () => Number(/(\d+) hidden by your mutes in this browser/
      .exec(await page.locator('#live-status').textContent() ?? '')?.[1] ?? 0)).toBeGreaterThanOrEqual(others)
    await expect(page.locator('#follow-picker option[value="1"]')).toHaveCount(1)
    await expect(page.locator('#follow-picker option[value="2"]')).toHaveCount(1)
  }
  await storeAndAnnounce(page, [{ type: 'resident', id: 1, choice: 'mute' }])
  await expect.poll(() => figureIds(page)).toEqual(expect.arrayContaining([1, 2, 135, 186]))
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('a mute naming the second founder hides nothing and counts nothing, even with its place muted', async ({ page }) => {
  // Resident #2 (1f3d9-founder) stands in place 3 with the founder in the saved census.
  await storeBeforeLoad(page, [{ type: 'resident', id: 2, choice: 'mute' }])
  const diagnostics = await keepFixtureOffline(page)
  await openRoom(page, liveFixtureUrl, '3')
  await expect.poll(() => figureIds(page), { timeout: 30_000 }).toEqual(expect.arrayContaining([1, 2, 135, 186]))
  await expect(page.locator('#live-status')).not.toContainText(COUNT_WORDS)
  await expect(page.locator('#follow-picker option[value="2"]')).toHaveCount(1)
  const others = (await figureIds(page)).filter(id => id !== 1 && id !== 2).length

  await storeAndAnnounce(page, [{ type: 'resident', id: 1, choice: 'mute' }, { type: 'resident', id: 2, choice: 'mute' },
    { type: 'place', id: 3, choice: 'mute' }])
  await expect.poll(() => figureIds(page)).toEqual([1, 2])
  await expect.poll(async () => Number(/(\d+) hidden by your mutes in this browser/
    .exec(await page.locator('#live-status').textContent() ?? '')?.[1] ?? 0)).toBeGreaterThanOrEqual(others)
  await expect(page.locator('#follow-picker option[value="1"]')).toHaveCount(1)
  await expect(page.locator('#follow-picker option[value="2"]')).toHaveCount(1)
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('unavailable browser storage draws the room as with no list', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true,
      get() { throw new Error('storage is unavailable') } })
  })
  const diagnostics = await keepFixtureOffline(page)
  await openRoom(page, liveFixtureUrl, '767')
  await expect.poll(() => thingIds(page), { timeout: 30_000 }).toContain(2803)
  await expect(page.locator('#live-status')).not.toContainText(COUNT_WORDS)
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})
