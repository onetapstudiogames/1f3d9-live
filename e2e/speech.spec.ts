import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const fixtureUrl = '/?replay=/fixtures/replay-places.json&census=/fixtures/residents-presence-page1.json&drawings=/fixtures/drawings&places=/fixtures/places'
const fixtureOrigin = 'http://localhost:4173'

async function keepFixtureOffline(page: Page): Promise<{ external: string[]; errors: string[] }> {
  const external: string[] = []; const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== fixtureOrigin) { external.push(url.href); await route.abort(); return }
    const drawing = /^\/fixtures\/drawings\/resident-(\d+)\.json$/.exec(url.pathname)
    if (!drawing) { await route.continue(); return }
    try { await route.fulfill({ contentType: 'application/json', body: await readFile(`public/fixtures/drawings/resident-${drawing[1]}.json`, 'utf8') }) }
    catch { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }) }
  })
  return { external, errors }
}

test('a recorded long note stays whole beside its speaker through layout and room changes', async ({ page }) => {
  // This fixture needs a room short enough to require pages, independently of project defaults.
  await page.setViewportSize({ width: 1280, height: 640 })
  await page.clock.install({ time: new Date('2026-09-07T13:54:04.254Z') })
  const diagnostics = await keepFixtureOffline(page)
  const note = JSON.parse(await readFile('public/fixtures/notes/note-13243.json', 'utf8')) as {
    note: { id: number; body: string; place_id: number }
  }
  const replay = JSON.parse(await readFile('public/fixtures/replay-places.json', 'utf8')) as { checkpoint: string }
  expect(replay.checkpoint).toBe('100123')
  expect(note.note).toMatchObject({ id: 13243, place_id: 782 })
  expect(note.note.body).toHaveLength(1016)

  let releaseChange!: () => void
  let changeRequested!: () => void
  const held = new Promise<void>(resolve => { releaseChange = resolve })
  const requested = new Promise<void>(resolve => { changeRequested = resolve })
  await page.route('**/fixtures/changes-live.json', async route => {
    changeRequested()
    await held
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      change_marker: '100128', next_since: '100128', has_more: false, unchanged: false, returned_items: 1,
      changes: [{ change_id: '100128', kind: 'note', actor: 'buzz', detail: { note_id: 13243, place_id: 782 },
        created_at: '2026-09-07T13:54:04.254Z' }],
    }) })
  })

  await page.goto(fixtureUrl)
  await requested
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  await page.locator('#place-picker').selectOption('782')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '782')
  releaseChange()

  const card = page.locator('.room-speech-card[data-note-id="13243"]')
  await expect(card).toBeVisible({ timeout: 30_000 })
  // Finish the held read before pausing; jumping ahead during it can fire its timeout.
  // Then assertions cannot consume a page's hold between manual samples.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000))
  await expect(card).toHaveAttribute('data-page', '0')
  await expect(card).toHaveAttribute('data-side', /^(above|below)$/)
  const pages = new Map<number, string>()
  const checkedPages = new Set<number>()
  for (let elapsed = 0; elapsed < 14_900; elapsed += 100) {
    const frame = await card.evaluate(element => ({ page: Number(element.dataset['page']),
      pageCount: Number(element.dataset['pageCount']), revealed: element.dataset['revealed'] ?? '',
      pageComplete: element.dataset['pageComplete'] === 'true', complete: element.dataset['complete'] === 'true' }))
    const prior = pages.get(frame.page) ?? ''
    if (frame.revealed.length >= prior.length) pages.set(frame.page, frame.revealed)
    if (frame.pageComplete && !checkedPages.has(frame.page)) {
      const completed = await card.evaluate(element => {
        const cardBox = element.getBoundingClientRect()
        const appBox = document.querySelector<HTMLElement>('#app')!.getBoundingClientRect()
        const footerBox = document.querySelector<HTMLElement>('#room-footer')!.getBoundingClientRect()
        return { visible: element.querySelector<HTMLElement>('.room-speech-words')!.textContent ?? '',
          revealed: element.dataset['revealed'] ?? '', cardTop: cardBox.top, cardBottom: cardBox.bottom,
          appTop: appBox.top, appBottom: appBox.bottom, scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight, footerTop: footerBox.top, footerBottom: footerBox.bottom }
      })
      expect(completed.visible.replaceAll('\n', '')).toBe(completed.revealed.replaceAll('\n', ''))
      expect(completed.cardTop).toBeGreaterThanOrEqual(completed.appTop)
      expect(completed.cardBottom).toBeLessThanOrEqual(completed.appBottom)
      expect(completed.scrollHeight).toBeLessThanOrEqual(completed.innerHeight)
      expect(completed.footerTop).toBeGreaterThanOrEqual(0)
      expect(completed.footerBottom).toBeLessThanOrEqual(completed.innerHeight)
      checkedPages.add(frame.page)
    }
    if (frame.complete) break
    await page.clock.runFor(100)
  }
  await expect(card).toHaveAttribute('data-complete', 'true')
  const pageCount = Number(await card.getAttribute('data-page-count'))
  expect(pageCount).toBeGreaterThan(1)
  expect(checkedPages.size).toBe(pageCount)
  expect([...Array(pageCount).keys()].map(index => pages.get(index) ?? '').join('')).toBe(note.note.body)

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
    const style = getComputedStyle(element)
    const words = element.querySelector<HTMLElement>('.room-speech-words')!
    return { cardOverflow: style.overflowY, lineHeight: Number.parseFloat(style.lineHeight), wordsHeight: words.getBoundingClientRect().height }
  })
  expect(lineLayout.cardOverflow).not.toBe('auto')
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
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})
