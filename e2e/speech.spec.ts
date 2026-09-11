import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { advanceToLivePoll, fixtureDirectory, json, liveFixtureUrl } from './live-fixture.ts'

const fixtureUrl = liveFixtureUrl
const cardSelector = '.room-speech-card[data-note-id="13243"]'

type SpeechSample = {
  at: number; revealed: string; visible: string; complete: boolean; side: string
  cardScrollTop: number; cardScrollHeight: number; cardClientHeight: number
  cardTop: number; cardBottom: number; appTop: number; appBottom: number
  scrollHeight: number; innerHeight: number; footerTop: number; footerBottom: number
}
type SpeechSamples = { frames: SpeechSample[]; started: boolean; complete: boolean; ended: string | null }
type SampleWindow = Window & { speechSamples?: SpeechSamples }

async function startSampling(page: Page): Promise<void> {
  await page.evaluate(selector => {
    const state: SpeechSamples = { frames: [], started: false, complete: false, ended: null }
    ;(window as SampleWindow).speechSamples = state
    const timer = window.setInterval(() => {
      // Resolve the current DOM node on every sample, without waiting for a missing card.
      const card = document.querySelector<HTMLElement>(selector)
      if (!card || !card.getClientRects().length) {
        if (state.started) { state.ended = card ? 'hidden' : 'removed'; window.clearInterval(timer) }
        return
      }
      state.started = true
      const box = card.getBoundingClientRect()
      const app = document.querySelector<HTMLElement>('#app')!.getBoundingClientRect()
      const footer = document.querySelector<HTMLElement>('#room-footer')!.getBoundingClientRect()
      const words = card.querySelector<HTMLElement>('.room-speech-words')!
      const frame: SpeechSample = {
        at: Number(document.body.dataset['liveElapsed']), revealed: card.dataset['revealed'] ?? '',
        visible: words.textContent ?? '', complete: card.dataset['complete'] === 'true', cardScrollTop: words.scrollTop,
        cardScrollHeight: words.scrollHeight, cardClientHeight: words.clientHeight,
        side: card.dataset['side'] ?? '', cardTop: box.top, cardBottom: box.bottom, appTop: app.top, appBottom: app.bottom,
        scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight,
        footerTop: footer.top, footerBottom: footer.bottom,
      }
      state.frames.push(frame)
      if (frame.complete && frame.revealed.length > 0) { state.complete = true; window.clearInterval(timer) }
    }, 100)
  }, cardSelector)
}

async function keepFixtureOffline(page: Page): Promise<{ external: string[]; errors: string[] }> {
  const external: string[] = []; const errors: string[] = []
  const fixtureOrigin = new URL(test.info().project.use.baseURL!).origin
  const directory = await fixtureDirectory('public/fixtures/replay-places.json')
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== fixtureOrigin) { external.push(url.href); await route.abort(); return }
    if (url.pathname === '/fixtures/map-current-page1.json') { await json(route, directory); return }
    if (url.pathname === '/fixtures/change-cursor.json') { await json(route, { change_marker: '100123' }); return }
    const drawing = /^\/fixtures\/drawings\/resident-(\d+)\.json$/.exec(url.pathname)
    if (!drawing) { await route.continue(); return }
    try { await route.fulfill({ contentType: 'application/json', body: await readFile(`public/fixtures/drawings/resident-${drawing[1]}.json`, 'utf8') }) }
    catch { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }) }
  })
  return { external, errors }
}

test('a newly witnessed long note stays whole beside its speaker through layout and room changes', async ({ page }) => {
  // The prior 120-second deadline expired on CI software rendering; this bounded
  // budget is separate from the unchanged 15-second simulated speech loop.
  test.setTimeout(240_000)
  // This fixture needs a room short enough to require card scrolling, independently of project defaults.
  await page.setViewportSize({ width: 1280, height: 640 })
  // Install and pause before the app creates timers, reads or speech. The one-minute jump
  // happens on the blank page, so it cannot consume a note or a pending read's timeout.
  await page.clock.install({ time: new Date('2026-09-07T13:53:04.254Z') })
  await page.clock.pauseAt(new Date('2026-09-07T13:54:04.254Z'))
  const diagnostics = await keepFixtureOffline(page)
  const note = JSON.parse(await readFile('public/fixtures/notes/note-13243.json', 'utf8')) as {
    note: { id: number; body: string; place_id: number }
  }
  expect(note.note).toMatchObject({ id: 13243, place_id: 782 })
  expect(note.note.body).toHaveLength(1016)

  let releaseChange!: () => void
  let changeRequested = false
  const held = new Promise<void>(resolve => { releaseChange = resolve })
  await page.route('**/fixtures/changes-live.json', async route => {
    changeRequested = true
    await held
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      change_marker: '100128', next_since: '100128', has_more: false, unchanged: false, returned_items: 1,
      changes: [{ change_id: '100128', kind: 'note', actor: 'buzz', detail: { note_id: 13243, place_id: 782 },
        created_at: '2026-09-07T13:54:04.254Z' }],
    }) })
  })

  await page.goto(fixtureUrl)
  // Boot may need animation frames; asynchronous fixture reads get real time to finish
  // between these tiny controlled steps, while the note response remains held.
  await expect.poll(async () => {
    await page.clock.runFor(16)
    return await page.locator('body').getAttribute('data-live-ready')
  }, { timeout: 30_000 }).toBe('true')
  await page.locator('#place-picker').selectOption('782')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '782')
  await advanceToLivePoll(page)
  await expect.poll(() => changeRequested).toBe(true)
  releaseChange()
  // This marker follows note enrichment and queueing. No animation time passes during the read.
  await expect(page.locator('body')).toHaveAttribute('data-live-poll', 'true')
  await startSampling(page)

  let samples: SpeechSamples = { frames: [], started: false, complete: false, ended: null }
  for (let elapsed = 0; elapsed < 15_000; elapsed += 500) {
    // Sample every 100ms inside the page; avoid hundreds of per-frame protocol round trips.
    await page.clock.runFor(500)
    samples = await page.evaluate(() => (window as SampleWindow).speechSamples!)
    expect(samples.ended, `card ended before the whole note: ${JSON.stringify(samples.frames.at(-1))}`).toBeNull()
    if (samples.complete) break
  }
  expect(samples.complete, `last speech sample: ${JSON.stringify(samples.frames.at(-1))}`).toBe(true)
  const progressive = samples.frames.filter(frame => !frame.complete && frame.revealed.length > 0)
  expect(new Set(progressive.map(frame => frame.revealed)).size).toBeGreaterThan(2)
  expect(samples.frames.at(-1)!.visible).toBe(note.note.body)
  expect(samples.frames.some(frame => frame.cardScrollTop > 0)).toBe(true)
  const finished = samples.frames.at(-1)!
  expect(finished.cardScrollTop + finished.cardClientHeight).toBeGreaterThanOrEqual(finished.cardScrollHeight - 1)
  expect(samples.frames.every(frame => frame.cardClientHeight === samples.frames[0]!.cardClientHeight)).toBe(true)
  for (const frame of samples.frames) {
    expect(frame.side).toMatch(/^(above|below)$/)
    expect(frame.visible.replaceAll('\n', '')).toBe(frame.revealed.replaceAll('\n', ''))
    expect(frame.cardTop).toBeGreaterThanOrEqual(frame.appTop)
    expect(frame.cardBottom).toBeLessThanOrEqual(frame.appBottom)
    expect(frame.scrollHeight).toBeLessThanOrEqual(frame.innerHeight)
    expect(frame.footerTop).toBeGreaterThanOrEqual(0)
    expect(frame.footerBottom).toBeLessThanOrEqual(frame.innerHeight)
  }

  const card = page.locator(cardSelector)
  // Sampling stopped at completion. The full typed note remains available for scrollback.
  await card.locator('.room-speech-words').evaluate(element => { element.scrollTop = 0 })
  await page.clock.runFor(100)
  expect(await card.locator('.room-speech-words').evaluate(element => element.scrollTop)).toBe(0)
  await page.clock.runFor(200)
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('data-complete', 'true')
  await expect(card.locator('.room-speech-words')).toHaveText(note.note.body)

  const initial = await card.boundingBox(); expect(initial).not.toBeNull()
  await page.setViewportSize({ width: 560, height: 720 })
  await page.clock.runFor(100)
  await expect.poll(async () => card.boundingBox()).not.toEqual(initial)
  const resized = await card.boundingBox(); expect(resized).not.toBeNull()
  expect(resized!.x).toBeGreaterThanOrEqual(0)
  expect(resized!.x + resized!.width).toBeLessThanOrEqual(560)

  const otherRoom = await page.locator('#place-picker option:not([value=""]):not([value="782"])').first().getAttribute('value')
  expect(otherRoom).not.toBeNull()
  await page.locator('#place-picker').selectOption(otherRoom!)
  await page.clock.runFor(100)
  await expect(card).toBeHidden()
  await page.locator('#place-picker').selectOption('782')
  await page.clock.runFor(100)
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('data-note-id', '13243')

  const lineLayout = await card.evaluate(element => {
    const words = element.querySelector<HTMLElement>('.room-speech-words')!
    return { cardOverflow: getComputedStyle(words).overflowY, lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight), wordsHeight: words.scrollHeight }
  })
  expect(lineLayout.cardOverflow).toBe('auto')
  expect(lineLayout.wordsHeight / lineLayout.lineHeight).toBeCloseTo(Math.round(lineLayout.wordsHeight / lineLayout.lineHeight), 5)
  const app = await page.locator('#app').boundingBox(); const visibleCard = await card.boundingBox()
  expect(app).not.toBeNull(); expect(visibleCard).not.toBeNull()
  expect(visibleCard!.y).toBeGreaterThanOrEqual(app!.y)
  expect(visibleCard!.y + visibleCard!.height).toBeLessThanOrEqual(app!.y + app!.height)
  const footer = page.locator('#room-footer')
  await expect(footer).toBeInViewport()
  expect(await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > window.innerWidth,
    vertical: document.documentElement.scrollHeight > window.innerHeight,
  }))).toEqual({ horizontal: false, vertical: false })

  // Expiry hides the card today; removing it is also a valid terminal state. Never
  // wait for the expired note to reappear in order to sample it.
  await page.clock.runFor(3_000)
  expect(await page.evaluate(selector => {
    const current = document.querySelector<HTMLElement>(selector)
    return !current || current.getClientRects().length === 0
  }, cardSelector)).toBe(true)
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})
