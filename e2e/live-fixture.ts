import { expect, test, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'

export const liveFixtureUrl = '/?census=/fixtures/residents-presence-page1.json&map=/fixtures/map-current-page1.json&cursor=/fixtures/change-cursor.json&changes=/fixtures/changes-live.json&drawings=/fixtures/drawings&places=/fixtures/places'

export async function fixtureDirectory(source = 'public/fixtures/replay-24h.json'): Promise<Record<string, unknown>> {
  const replay = JSON.parse(await readFile(source, 'utf8')) as {
    map: { places: unknown[] }
  }
  return { view: 'directory', places: replay.map.places }
}

export async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

export async function advanceToLivePoll(page: Page): Promise<void> {
  // Let a frame run after each jump: one starved frame spanning the whole cadence would
  // read as a render gap (live-continuity) and turn the due poll into a fresh-head read.
  for (let elapsed = 0; elapsed < 30_000; elapsed += 10_000) {
    await page.clock.fastForward(10_000)
    await page.clock.runFor(32)
  }
  await page.clock.fastForward(1)
}

export async function keepFixtureOffline(page: Page): Promise<{ external: string[]; errors: string[] }> {
  const external: string[] = []; const errors: string[] = []
  const fixtureOrigin = new URL(test.info().project.use.baseURL!).origin
  const directory = await fixtureDirectory()
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== fixtureOrigin) { external.push(url.href); await route.abort(); return }
    if (url.pathname === '/fixtures/map-current-page1.json') { await json(route, directory); return }
    if (url.pathname === '/fixtures/change-cursor.json') { await json(route, { change_marker: '100297' }); return }
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
  return { external, errors }
}

export const factsLaw = { traitId: 478, name: 'shared condition', sourcePlaceId: 440, position: 0, recipe: null }
export const factsPlaces = [
  { id: 440, name: 'source room', parent_id: null, owner: 'serein', owner_id: 223, quiet: false, has_drawing: false },
  { id: 1124, name: 'child room', parent_id: 440, owner: 'serein', owner_id: 223, quiet: false, has_drawing: false },
]
export type FactsState = { labels?: readonly string[]; laws?: readonly typeof factsLaw[]; quiet?: boolean; name?: string; status?: number }

export async function factsFixture(page: Page, state: () => FactsState = () => ({ labels: ['local-condition'], laws: [factsLaw] }),
  directory = () => factsPlaces, options: { placeId?: number; search?: string; directoryStatus?: () => number } = {}) {
  await page.clock.install({ time: Date.parse('2026-09-07T01:30:42.383Z') })
  await page.clock.pauseAt(Date.parse('2026-09-07T01:31:42.383Z'))
  const diagnostics = await keepFixtureOffline(page)
  const reads: number[] = []
  await page.route('**/fixtures/map-current-page1.json', route => json(route, { view: 'directory', places: directory() }, options.directoryStatus?.() ?? 200))
  await page.route('**/fixtures/changes-live.json*', route => json(route,
    { change_marker: '100297', next_since: '100297', has_more: false, unchanged: true, changes: [] }))
  await page.route('**/fixtures/places/place-*.json*', route => {
    const id = Number(/place-(\d+)/.exec(route.request().url())![1])
    reads.push(id)
    const facts = id === (options.placeId ?? 1124) ? state() : { labels: ['shared-condition'], laws: [factsLaw] }
    const place = directory().find(row => row.id === id)
    return json(route, { place: { ...place, ...facts }, things: [], things_page: { total_items: 0, has_more: false } }, facts.status ?? 200)
  })
  await page.goto(`${liveFixtureUrl}&place=${options.placeId ?? 1124}${options.search ?? ''}`)
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
  return { ...diagnostics, reads }
}
