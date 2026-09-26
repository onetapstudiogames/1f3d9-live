import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { advanceToLivePoll, fixtureDirectory, json, liveFixtureUrl } from './live-fixture.ts'

type Diagnostics = { external: string[]; errors: string[]; requests: string[] }

async function keepTalkFixtureOffline(page: Page, directoryOverride?: Record<string, unknown>): Promise<Diagnostics> {
  const external: string[] = []; const errors: string[] = []; const requests: string[] = []
  const fixtureOrigin = new URL(test.info().project.use.baseURL!).origin
  const directory = directoryOverride ?? await fixtureDirectory()
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

// The clock is installed a minute before it pauses, as the other specs do: pausing at the
// install time itself fails whenever a millisecond passes between the two calls.
function installTime(): Date { return new Date('2026-09-07T13:53:04.254Z') }
function talkTime(): Date { return new Date('2026-09-07T13:54:04.254Z') }

const emptyTalkHead = { line_marker: '0', check_interval_ms: 2_000, listening: [],
  listening_page: { total_items: 0, returned_items: 0, has_more: false } }

async function makeIdle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const idleTime = Date.now() + 30 * 60_000 + 1
    Date.now = () => idleTime
  })
  await page.clock.runFor(32)
}

async function quietParentDirectory(): Promise<Record<string, unknown>> {
  const directory = await fixtureDirectory()
  const places = directory['places'] as Array<Record<string, unknown>>
  return { ...directory, places: places.map(place => place['id'] === 731 ? { ...place, quiet: true } : place) }
}

test('a line said in the shown room shows on a small card and in the log', async ({ page }) => {
  await page.clock.install({ time: installTime() })
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

test('wheel input does not postpone a talk check that is almost due', async ({ page }) => {
  await page.clock.install({ time: installTime() })
  await page.clock.pauseAt(talkTime())
  const diagnostics = await keepTalkFixtureOffline(page)
  const reads = { count: 0 }
  await page.route('**/fixtures/talk-now-line.json', route => serveTalkHead(route, reads))
  await page.goto(talkUrl())
  await ready(page)
  await page.locator('#place-picker').selectOption('731')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '731')
  await checkUntil(page, async () => String(reads.count), '1')
  await expect(page.locator('body')).toHaveAttribute('data-live-talk-marker', '100297')

  await page.clock.fastForward(1_500)
  await page.clock.runFor(32)
  await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel')))
  // The check is due 2 to 2.5 seconds after the last one ended; a postponed one would land past 3.5.
  await page.clock.fastForward(1_000)
  await page.clock.runFor(32)
  await expect.poll(() => reads.count, { timeout: 1_000 }).toBe(2)
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('steady wheel input does not starve the talk check loop', async ({ page }) => {
  await page.clock.install({ time: installTime() })
  await page.clock.pauseAt(talkTime())
  const diagnostics = await keepTalkFixtureOffline(page)
  const reads = { count: 0 }
  await page.route('**/fixtures/talk-now-line.json', route => serveTalkHead(route, reads))
  await page.goto(talkUrl())
  await ready(page)
  await page.locator('#place-picker').selectOption('731')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '731')
  await checkUntil(page, async () => String(reads.count), '1')
  const firstRead = reads.count

  // With the random wait a check comes every 4 or 5 of these steps, so 30 steps hold at least 4 more.
  for (let index = 0; index < 30; index += 1) {
    await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel')))
    await page.clock.fastForward(500)
    await page.clock.runFor(32)
  }

  expect(reads.count).toBeGreaterThanOrEqual(firstRead + 4)
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('a talk check keeps the refresh cycle outline issue visible', async ({ page }) => {
  await page.clock.install({ time: installTime() })
  await page.clock.pauseAt(talkTime())
  const diagnostics = await keepTalkFixtureOffline(page)
  let talkReads = 0
  let successfulTalkReads = 0
  let allowTalkSuccess = true
  await page.route('**/fixtures/talk-now-line.json', async route => {
    talkReads += 1
    if (!allowTalkSuccess) { await json(route, {}, 503); return }
    await json(route, emptyTalkHead)
    successfulTalkReads += 1
  })
  await page.goto(talkUrl())
  await ready(page)
  await checkUntil(page, async () => String(talkReads), '1')
  await expect(page.locator('body')).toHaveAttribute('data-live-talk-marker', '0')
  const roomId = await page.locator('body').getAttribute('data-live-room')
  expect(roomId).toBeTruthy()
  const outline = JSON.parse(await readFile(`public/fixtures/places/place-${roomId}.json`, 'utf8')) as Record<string, unknown>
  let outlineReads = 0
  await page.route(`**/fixtures/places/place-${roomId}.json`, async route => {
    outlineReads += 1
    if (outlineReads === 1) { await json(route, {}, 503); return }
    await json(route, outline)
  })
  allowTalkSuccess = false

  await advanceToLivePoll(page)
  await expect(page.locator('body')).toHaveAttribute('data-live-poll', 'true')
  expect(outlineReads).toBe(1)
  await expect(page.locator('#live-status')).toContainText('This room outline could not be read; its floor is kept.')
  allowTalkSuccess = true
  await makeIdle(page)
  await page.evaluate(() => window.dispatchEvent(new WheelEvent('wheel')))
  // A restored check is due within the served interval plus the random wait.
  await page.clock.fastForward(2_600)
  await page.clock.runFor(32)
  await expect.poll(() => successfulTalkReads).toBe(2)
  expect(outlineReads).toBe(1)
  await expect(page.locator('#live-status')).toContainText('This room outline could not be read; its floor is kept.')
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('a quiet ancestor hides listening resident ids from the page', async ({ page }) => {
  await page.clock.install({ time: installTime() })
  await page.clock.pauseAt(talkTime())
  const diagnostics = await keepTalkFixtureOffline(page, await quietParentDirectory())
  const reads = { count: 0 }
  await page.route('**/fixtures/talk-now-line.json', async route => {
    reads.count += 1
    await json(route, { ...emptyTalkHead, listening: [{ place_id: 732, resident_id: 316,
      handle: 'buzz', listening_until: '2026-09-07T13:54:35.000Z' }] })
  })
  await page.goto(talkUrl())
  await ready(page)
  await page.locator('#place-picker').selectOption('732')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '732')
  await checkUntil(page, async () => String(reads.count), '1')

  await expect(page.locator('body')).not.toHaveAttribute('data-live-talk-listeners')
  await expect(page.locator('body')).toHaveAttribute('data-live-listening', '')
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('thirty steady talk checks each wait the served interval plus a fresh random wait of up to half a second', async ({ page }) => {
  test.setTimeout(120_000)
  await page.clock.install({ time: installTime() })
  await page.clock.pauseAt(talkTime())
  // Record, on the page's own clock, when each talk check starts (its talk head read) and when it
  // ends and picks its next wait (data-live-talk-marker is set at the end of every check).
  await page.addInitScript(() => {
    const times = { started: [] as number[], ended: [] as number[] }
    Object.defineProperty(window, 'talkTimes', { value: times })
    const originalFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      if (String(input).includes('talk-now-line.json')) times.started.push(Date.now())
      return originalFetch(input, init)
    }
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(records => {
        for (const record of records) {
          if (record.attributeName === 'data-live-talk-marker') times.ended.push(Date.now())
        }
      }).observe(document.body, { attributes: true, attributeFilter: ['data-live-talk-marker'] })
    })
  })
  const diagnostics = await keepTalkFixtureOffline(page)
  await page.route('**/fixtures/talk-now-line.json', route => json(route, emptyTalkHead))
  await page.goto(talkUrl())
  await ready(page)
  const readTimes = () => page.evaluate(() =>
    (window as unknown as { talkTimes: { started: number[]; ended: number[] } }).talkTimes)
  // Short jumps with one frame each, as the other tests here step. A check due inside a jump starts
  // at the jump's end, so a gap may run up to one jump (100 ms) past its wait.
  await expect.poll(async () => {
    await page.clock.fastForward(100)
    await page.clock.runFor(16)
    const { started, ended } = await readTimes()
    return Math.min(started.length - 1, ended.length)
  }, { timeout: 100_000, intervals: [10] }).toBeGreaterThanOrEqual(30)

  const { started, ended } = await readTimes()
  const gaps = started.slice(1, 31).map((at, index) => at - ended[index]!)
  expect(gaps).toHaveLength(30)
  for (const gap of gaps) {
    expect(gap).toBeGreaterThanOrEqual(2_000)
    expect(gap).toBeLessThanOrEqual(2_600)
  }
  expect(new Set(gaps).size).toBeGreaterThan(1)
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('idle status keeps a required read failure sentence visible', async ({ page }) => {
  await page.clock.install({ time: installTime() })
  await page.clock.pauseAt(talkTime())
  const diagnostics = await keepTalkFixtureOffline(page)
  let feedReads = 0
  await page.route('**/fixtures/changes-live.json', async route => {
    feedReads += 1
    await json(route, {}, 503)
  })
  await page.route('**/fixtures/talk-now-line.json', route => json(route, { ...emptyTalkHead, check_interval_ms: 600_000 }))
  await page.goto(talkUrl())
  await ready(page)
  await makeIdle(page)
  await advanceToLivePoll(page)

  await expect.poll(() => feedReads).toBe(1)
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'true')
  await expect(page.locator('#live-status')).toContainText('The public record could not be read. Keeping the last picture and retrying.')
  await expect(page.locator('#live-status')).toContainText('After 30 idle minutes')
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('idle status keeps the quiet room owner sentence visible', async ({ page }) => {
  await page.clock.install({ time: installTime() })
  await page.clock.pauseAt(talkTime())
  const diagnostics = await keepTalkFixtureOffline(page, await quietParentDirectory())
  await page.route('**/fixtures/talk-now-line.json', route => json(route, { ...emptyTalkHead, check_interval_ms: 600_000 }))
  await page.goto(talkUrl())
  await ready(page)
  await page.locator('#place-picker').selectOption('731')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '731')
  await makeIdle(page)

  await expect(page.locator('#live-status')).toContainText('thehivequeenbeeatrix prefers to keep this room private.')
  await expect(page.locator('#live-status')).toContainText('After 30 idle minutes')
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('a line both loops read is logged once', async ({ page }) => {
  await page.clock.install({ time: installTime() })
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
  await page.clock.install({ time: installTime() })
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
  // Five check intervals pass while hidden. Each jump fires every timer due in it once, so a
  // talk check that kept rescheduling itself would read the head once per jump. The jumps skip
  // the frames between: a hidden tab draws none, and runFor(2_000) would draw 125 each, which a
  // slow runner cannot finish inside the test's minute.
  for (let step = 0; step < 5; step += 1) {
    await page.clock.fastForward(2_000)
    await page.clock.runFor(32)
  }
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
