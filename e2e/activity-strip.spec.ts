import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { advanceToLivePoll, fixtureDirectory, json, liveFixtureUrl } from './live-fixture.ts'

const fixtureUrl = liveFixtureUrl
const fullBody = Array.from({ length: 8 }, (_, index) => `complete witnessed line ${index + 1}`).join('\n')

async function installFixture(page: Page): Promise<{ external: string[]; errors: string[]; releaseChanges: () => void; releaseNote: () => void; changeReads: () => number }> {
  const external: string[] = []; const errors: string[] = []
  let releaseNote!: () => void
  const heldNote = new Promise<void>(resolve => { releaseNote = resolve })
  let releaseChanges!: () => void
  let changeReads = 0
  const heldChanges = new Promise<void>(resolve => { releaseChanges = resolve })
  const fixtureOrigin = new URL(test.info().project.use.baseURL!).origin
  const directory = await fixtureDirectory()
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== fixtureOrigin) { external.push(url.href); await route.abort(); return }
    if (url.pathname === '/fixtures/map-current-page1.json') { await json(route, directory); return }
    if (url.pathname === '/fixtures/change-cursor.json') { await json(route, { change_marker: '98979' }); return }
    if (url.pathname === '/fixtures/notes/note-90001.json') {
      await heldNote
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        note: { id: 90001, author: 'smokecheck', place_id: 8, body: fullBody },
      }) }); return
    }
    if (url.pathname === '/fixtures/notes/note-90002.json') {
      await json(route, { note: { id: 90002, author: 'dpl', place_id: 2, body: 'other room only' } }); return
    }
    const drawing = /^\/fixtures\/drawings\/resident-(\d+)\.json$/.exec(url.pathname)
    if (drawing) {
      try { await route.fulfill({ contentType: 'application/json', body: await readFile(`public/fixtures/drawings/resident-${drawing[1]}.json`, 'utf8') }) }
      catch { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }) }
      return
    }
    await route.continue()
  })
  await page.route('**/fixtures/changes-live.json', async route => {
    changeReads += 1
    await heldChanges
    await json(route, { change_marker: '98981', next_since: '98981', has_more: false, unchanged: false, returned_items: 2, changes: [
      { actor: 'smokecheck', created_at: '2026-09-07T01:29:00.000Z', change_id: '98980', kind: 'note', detail: { note_id: 90001, place_id: 8 } },
      { actor: 'dpl', created_at: '2026-09-07T01:29:30.000Z', change_id: '98981', kind: 'note', detail: { note_id: 90002, place_id: 2 } },
    ] })
  })
  return { external, errors, releaseChanges, releaseNote, changeReads: () => changeReads }
}

async function fixedPageState(page: Page) {
  return page.evaluate(() => {
    const bounds = (selector: string) => {
      const box = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right }
    }
    return { documentHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight,
      follow: bounds('#follow-picker'), place: bounds('#place-picker') }
  })
}

test('the room log scrolls inside a fixed strip and stays with public room changes', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-08T12:00:00.000Z') })
  for (const viewport of [{ width: 1280, height: 800, stripHeight: 60 }, { width: 375, height: 812, stripHeight: 40 }]) {
    await page.setViewportSize(viewport)
    const diagnostics = await installFixture(page)
    await page.goto(fixtureUrl)
    await expect.poll(() => page.evaluate(() => document.body.dataset['liveReady'] ?? ''), { timeout: 30_000 }).toBe('true')
    await page.locator('#place-picker').selectOption('8')
    await expect(page.locator('body')).toHaveAttribute('data-live-room', '8')
    await advanceToLivePoll(page)
    await expect.poll(() => diagnostics.changeReads()).toBeGreaterThanOrEqual(1)
    diagnostics.releaseChanges()
    diagnostics.releaseNote()

    const strip = page.locator('#room-activity')
    await expect(page.locator('body')).toHaveAttribute('data-live-poll', 'true')
    await expect(strip).toContainText(fullBody)
    await strip.evaluate(element => {
      const entry = [...element.children].find(node => node.textContent?.includes('complete witnessed line 1'))!
      entry.setAttribute('data-retained-node', 'true')
    })
    await expect(strip.locator('[data-retained-node="true"]')).toContainText(fullBody)
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
    await expect(strip).toContainText(fullBody)
    await expect(strip).not.toContainText('other room only')
    expect(await fixedPageState(page)).toEqual(fixedBefore)
    expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
    await page.unrouteAll({ behavior: 'wait' })
  }
})
