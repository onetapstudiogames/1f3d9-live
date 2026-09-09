import { test, type Page, type Route } from '@playwright/test'
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
  for (let elapsed = 0; elapsed < 30_000; elapsed += 10_000) await page.clock.fastForward(10_000)
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
    const drawing = /^\/fixtures\/drawings\/resident-(\d+)\.json$/.exec(url.pathname)
    if (!drawing) { await route.continue(); return }
    try { await route.fulfill({ contentType: 'application/json', body: await readFile(`public/fixtures/drawings/resident-${drawing[1]}.json`, 'utf8') }) }
    catch { await json(route, {}, 404) }
  })
  return { external, errors }
}
