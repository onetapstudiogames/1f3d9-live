import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { advanceToLivePoll, fixtureDirectory, json, liveFixtureUrl } from './live-fixture.ts'

type Diagnostics = { external: string[]; errors: string[]; requests: string[] }

async function keepTalkFixtureOffline(page: Page): Promise<Diagnostics> {
  const external: string[] = []; const errors: string[] = []; const requests: string[] = []
  const fixtureOrigin = new URL(test.info().project.use.baseURL!).origin
  const directory = await fixtureDirectory()
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    requests.push(`${url.pathname}${url.search}`)
    if (url.origin !== fixtureOrigin) { external.push(url.href); await route.abort(); return }
    if (url.pathname === '/fixtures/map-current-page1.json') {
      await json(route, directory)
      return
    }
    if (url.pathname === '/fixtures/change-cursor.json') {
      await json(route, { change_marker: '100297' })
      return
    }
    const thing = /^\/fixtures\/things\/thing-(\d+)\.json$/.exec(url.pathname)
    if (thing) {
      try { await route.fulfill({ contentType: 'application/json', body: await readFile(`public/fixtures/things/thing-${thing[1]}.json`, 'utf8') }) }
      catch { await json(route, {}, 404) }
      return
    }
    const drawing = /^\/fixtures\/drawings\/(resident|thing)-(\d+)\.json$/.exec(url.pathname)
    if (!drawing) { await route.continue(); return }
    try { await route.fulfill({ contentType: 'application/json', body: await readFile(`public/fixtures/drawings/${drawing[1]}-${drawing[2]}.json`, 'utf8') }) }
    catch { await json(route, {}, 404) }
  })
  return { external, errors, requests }
}

async function serveTalkHead(route: Route, reads: { count: number }): Promise<void> {
  reads.count += 1
  const head = JSON.parse(await readFile('public/fixtures/talk-now-line.json', 'utf8')) as Record<string, unknown>
  if (reads.count === 1) head['line_marker'] = '100297'
  await json(route, head)
}

function talkUrl(): string {
  return `${liveFixtureUrl}&talk=/fixtures/talk-now-line.json&roomlines=/fixtures/room-lines`
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
}

async function stepUntil(page: Page, read: () => Promise<string | null>, expected: string): Promise<void> {
  await expect.poll(async () => {
    await page.clock.runFor(100)
    return read()
  }, { timeout: 30_000, intervals: [10] }).toBe(expected)
}

async function checkUntil(page: Page, read: () => Promise<string | null>, expected: string): Promise<void> {
  await expect.poll(async () => {
    const current = await read()
    if (current === expected) return current
    await page.clock.fastForward(1_000)
    await page.clock.runFor(32)
    return read()
  }, { timeout: 30_000, intervals: [10] }).toBe(expected)
}

function talkTime(): Date { return new Date('2026-09-07T13:54:04.254Z') }

test('a line said in the shown room shows on a small card and in the log', async ({ page }) => {
  await page.clock.install({ time: talkTime() })
  await page.clock.pauseAt(talkTime())
  const diagnostics = await keepTalkFixtureOffline(page)
  const reads = { count: 0 }
  await page.route('**/fixtures/talk-now-line.json', route => serveTalkHead(route, reads))
  await page.goto(talkUrl())
  await ready(page)
  await page.locator('#place-picker').selectOption('731')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '731')

  const card = page.locator('.room-speech-card[data-kind="line"][data-line-id="9001"]')
  await checkUntil(page, async () => String(await card.count()), '1')
  await expect(page.locator('body')).toHaveAttribute('data-live-listening', '302')
  await stepUntil(page, () => card.getAttribute('data-revealed'), 'A line from the talk fixture.')
  await expect(page.locator('#room-activity')).toContainText('buzz: A line from the talk fixture.')
  expect(diagnostics.requests.filter(url => url === '/fixtures/room-lines/lines-731-100297.json')).toHaveLength(1)
  expect(diagnostics.requests.filter(url => url === '/fixtures/room-lines/lines-731-100299.json')).toHaveLength(1)
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('a line both loops read is logged once', async ({ page }) => {
  await page.clock.install({ time: talkTime() })
  await page.clock.pauseAt(talkTime())
  const diagnostics = await keepTalkFixtureOffline(page)
  const reads = { count: 0 }
  await page.route('**/fixtures/talk-now-line.json', route => serveTalkHead(route, reads))
  await page.goto(talkUrl().replace('changes=/fixtures/changes-live.json', 'changes=/fixtures/changes-talk-line.json'))
  await ready(page)
  await page.locator('#place-picker').selectOption('731')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '731')

  const card = page.locator('.room-speech-card[data-kind="line"][data-line-id="9001"]')
  await page.evaluate(() => {
    const state = window as typeof window & { lineCardAdds?: number; lineCardVisible?: boolean }
    const isVisible = (): boolean => [...document.querySelectorAll<HTMLElement>(
      '.room-speech-card[data-kind="line"][data-line-id="9001"]')]
      .some(card => Boolean(card.dataset['revealed']) && card.getClientRects().length > 0)
    state.lineCardVisible = isVisible()
    state.lineCardAdds = state.lineCardVisible ? 1 : 0
    new MutationObserver(() => {
      const visible = isVisible()
      if (visible && !state.lineCardVisible) state.lineCardAdds = (state.lineCardAdds ?? 0) + 1
      state.lineCardVisible = visible
    }).observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-kind', 'data-line-id', 'data-revealed', 'style'] })
  })
  await checkUntil(page, async () => String(await card.count()), '1')
  await stepUntil(page, () => card.getAttribute('data-revealed'), 'A line from the talk fixture.')
  await advanceToLivePoll(page)
  await expect.poll(async () => {
    await page.clock.runFor(16)
    return await page.locator('body').getAttribute('data-live-poll')
  }, { timeout: 30_000 }).toBe('true')
  await expect(page.locator('#room-activity').getByText('buzz: A line from the talk fixture.', { exact: true })).toHaveCount(1)
  expect(await page.evaluate(() => (window as typeof window & { lineCardAdds?: number }).lineCardAdds)).toBe(1)
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('a hidden page makes no talk check, and a return starts from now', async ({ page }) => {
  await page.clock.install({ time: talkTime() })
  await page.clock.pauseAt(talkTime())
  const diagnostics = await keepTalkFixtureOffline(page)
  const reads = { count: 0 }
  await page.route('**/fixtures/talk-now-line.json', route => serveTalkHead(route, reads))
  await page.goto(talkUrl())
  await ready(page)
  await page.locator('#place-picker').selectOption('731')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '731')
  await checkUntil(page, async () => String(diagnostics.requests.filter(url => url === '/fixtures/room-lines/lines-731-100297.json').length), '1')

  await page.evaluate(() => {
    const state = window as typeof window & { fixtureHidden?: boolean }
    state.fixtureHidden = true
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state.fixtureHidden })
    Object.defineProperty(document, 'visibilityState', { configurable: true,
      get: () => state.fixtureHidden ? 'hidden' : 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  for (let step = 0; step < 5; step += 1) await page.clock.runFor(2_000)
  expect(reads.count).toBe(1)

  await page.evaluate(() => {
    const state = window as typeof window & { fixtureHidden?: boolean }
    state.fixtureHidden = false
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await checkUntil(page, async () => String(reads.count), '2')
  await checkUntil(page, async () => String(diagnostics.requests.filter(url => url === '/fixtures/room-lines/lines-731-100299.json').length), '1')
  await expect(page.locator('.room-speech-card[data-kind="line"][data-line-id="9001"]')).toHaveCount(0)
  await expect(page.locator('#room-activity')).not.toContainText('buzz: A line from the talk fixture.')
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})
