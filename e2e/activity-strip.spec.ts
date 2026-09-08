import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const fixtureUrl = '/?replay=/fixtures/activity-strip-replay.json&census=/fixtures/residents-presence-page1.json&drawings=/fixtures/drawings&places=/fixtures/places'
const fullBody = Array.from({ length: 8 }, (_, index) => `complete recorded line ${index + 1}`).join('\n')

async function installFixture(page: Page): Promise<{ external: string[]; errors: string[] }> {
  const external: string[] = []; const errors: string[] = []
  const fixtureOrigin = new URL(test.info().project.use.baseURL!).origin
  const replay = JSON.parse(await readFile('public/fixtures/replay-24h.json', 'utf8')) as Record<string, unknown>
  const activityReplay = { ...replay, timeline: [
    { actor: 'thog', at: '2026-09-07T01:29:00.000Z', change_id: '98980', event_id: 98980,
      kind: 'note', detail: { note_id: 90001, place_id: 8 }, line: fullBody, line_cut: false },
    { actor: 'thog', at: '2026-09-07T01:29:30.000Z', change_id: '98981', event_id: 98981,
      kind: 'note', detail: { note_id: 90002, place_id: 2 }, line: 'other room only', line_cut: false },
  ] }
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== fixtureOrigin) { external.push(url.href); await route.abort(); return }
    if (url.pathname === '/fixtures/activity-strip-replay.json') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(activityReplay) }); return
    }
    const drawing = /^\/fixtures\/drawings\/resident-(\d+)\.json$/.exec(url.pathname)
    if (drawing) {
      try { await route.fulfill({ contentType: 'application/json', body: await readFile(`public/fixtures/drawings/resident-${drawing[1]}.json`, 'utf8') }) }
      catch { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }) }
      return
    }
    await route.continue()
  })
  return { external, errors }
}

async function fixedPageState(page: Page) {
  return page.evaluate(() => {
    const bounds = (selector: string) => {
      const box = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right }
    }
    return { documentHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight,
      follow: bounds('#follow-picker'), place: bounds('#place-picker'), pause: bounds('#pause') }
  })
}

test('full room history scrolls inside a fixed strip and filters when the room changes', async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 800, stripHeight: 60 }, { width: 375, height: 812, stripHeight: 40 }]) {
    await page.setViewportSize(viewport)
    const diagnostics = await installFixture(page)
    await page.goto(fixtureUrl)
    await expect.poll(() => page.evaluate(() => document.body.dataset['liveReady'] ?? ''), { timeout: 30_000 }).toBe('true')
    await page.locator('#place-picker').selectOption('8')
    await expect(page.locator('body')).toHaveAttribute('data-live-room', '8')

    const strip = page.locator('#room-activity')
    await expect(strip).toContainText(fullBody)
    await expect(strip).not.toContainText('other room only')
    const overflow = await strip.evaluate(element => ({ clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight, scrollTop: element.scrollTop,
      overflowY: getComputedStyle(element).overflowY, whiteSpace: getComputedStyle(element).whiteSpace }))
    expect(overflow.clientHeight).toBe(viewport.stripHeight)
    expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight)
    expect(overflow.scrollTop).toBe(overflow.scrollHeight - overflow.clientHeight)
    expect(overflow).toMatchObject({ overflowY: 'auto', whiteSpace: 'pre-wrap' })

    const fixedBefore = await fixedPageState(page)
    expect(fixedBefore.documentHeight).toBeLessThanOrEqual(fixedBefore.viewportHeight)
    await strip.evaluate(element => { element.scrollTop = 0 })
    expect(await strip.evaluate(element => element.scrollTop)).toBe(0)
    await strip.evaluate(element => { element.scrollTop = element.scrollHeight })
    expect(await strip.evaluate(element => element.scrollTop)).toBe(overflow.scrollHeight - overflow.clientHeight)
    expect(await fixedPageState(page)).toEqual(fixedBefore)

    await page.locator('#place-picker').selectOption('2')
    await expect(strip).toContainText('other room only')
    await expect(strip).not.toContainText('complete recorded line')
    expect(await fixedPageState(page)).toEqual(fixedBefore)
    expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
    await page.unrouteAll({ behavior: 'wait' })
  }
})
