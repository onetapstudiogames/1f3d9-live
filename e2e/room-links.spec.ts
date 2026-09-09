import { expect, test, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { keepFixtureOffline, liveFixtureUrl } from './live-fixture.ts'

const namedPlace = '310'
const residentHandle = 'galaxy-orb'
const residentId = '316'
const prefixPlace = '1'

async function ready(page: Page): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
}

test('?place opens the named public room instead of the busiest room', async ({ page }) => {
  let navigations = 0
  page.on('request', request => { if (request.isNavigationRequest()) navigations += 1 })
  const diagnostics = await keepFixtureOffline(page)
  await page.goto(`${liveFixtureUrl}&place=${namedPlace}`)
  await ready(page)
  const historyLength = await page.evaluate(() => history.length)

  await expect(page.locator('body')).toHaveAttribute('data-live-room', namedPlace)
  await expect(page.locator('body')).toHaveAttribute('data-live-following', '')
  await expect(page.locator('#place-picker')).toHaveValue(namedPlace)
  await page.locator('#place-picker').selectOption('4')
  await expect.poll(() => page.evaluate(() => location.search)).toContain('place=4')
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.search).get('resident'))).toBeNull()
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.search).get('census')))
    .toBe('/fixtures/residents-presence-page1.json')
  await page.locator('#place-picker').selectOption('')
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.search).get('place'))).toBeNull()
  expect(await page.evaluate(() => history.length)).toBe(historyLength)
  expect(navigations).toBe(1)
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('?resident follows an awake public resident and wins over ?place', async ({ page }) => {
  let navigations = 0
  page.on('request', request => { if (request.isNavigationRequest()) navigations += 1 })
  const diagnostics = await keepFixtureOffline(page)
  await page.goto(`${liveFixtureUrl}&place=4&resident=${residentHandle}`)
  await ready(page)

  await expect(page.locator('body')).toHaveAttribute('data-live-room', namedPlace)
  await expect(page.locator('body')).toHaveAttribute('data-live-following', residentId)
  await expect(page.locator('#follow-picker')).toHaveValue(residentId)
  const historyLength = await page.evaluate(() => history.length)
  await page.locator('#follow-picker').selectOption('')
  await expect(page.locator('body')).toHaveAttribute('data-live-following', '')
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.search).get('resident'))).toBeNull()
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.search).get('place'))).toBeNull()
  await page.locator('#follow-picker').selectOption(residentId)
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.search).get('resident'))).toBe(residentHandle)
  await expect.poll(() => page.evaluate(() => new URLSearchParams(location.search).get('place'))).toBeNull()
  expect(await page.evaluate(() => history.length)).toBe(historyLength)
  expect(navigations).toBe(1)
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('the built page and relative fixtures work below /live/', async ({ browser }) => {
  const server = await serveBuiltLivePage()
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('the test server did not open a TCP port')
  const origin = `http://127.0.0.1:${address.port}`
  const context = await browser.newContext()
  const page = await context.newPage()
  const requests: string[] = []
  const successfulResponses: string[] = []
  const unexpectedOrigins: string[] = []
  const errors: string[] = []
  page.on('request', request => requests.push(new URL(request.url()).pathname))
  page.on('response', response => { if (response.ok()) successfulResponses.push(new URL(response.url()).pathname) })
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', route => {
    const requestOrigin = new URL(route.request().url()).origin
    if (requestOrigin === origin) return route.fallback()
    unexpectedOrigins.push(requestOrigin)
    return route.abort()
  })
  await context.route(`${origin}/live/fixtures/map-current-page1.json`, async route => {
    const replay = JSON.parse(await readFile('public/fixtures/replay-24h.json', 'utf8')) as { map: { places: unknown[] } }
    await route.fulfill({ json: { view: 'directory', places: replay.map.places } })
  })
  await context.route(`${origin}/live/fixtures/change-cursor.json`, route => route.fulfill({ json: { change_marker: '100297' } }))
  try {
    const query = new URLSearchParams({
      census: 'fixtures/residents-presence-page1.json',
      map: 'fixtures/map-current-page1.json',
      cursor: 'fixtures/change-cursor.json',
      drawings: 'fixtures/drawings',
      place: prefixPlace,
    })
    await page.goto(`${origin}/live?${query}`)
    await ready(page)

    expect(page.url()).toContain(`/live/?${query}`)
    await expect(page.locator('body')).toHaveAttribute('data-live-room', prefixPlace)
    expect(requests.some(path => path.startsWith('/live/assets/'))).toBe(true)
    expect(requests).toContain('/live/fixtures/residents-presence-page1.json')
    expect(requests).toContain('/live/fixtures/map-current-page1.json')
    await expect.poll(() => successfulResponses).toContain(`/live/fixtures/drawings/place-${prefixPlace}.json`)
    await page.locator('#place-picker').selectOption('3')
    await expect(page.locator('body')).toHaveAttribute('data-live-room', '3')
    await expect.poll(() => successfulResponses).toContain('/live/fixtures/places/place-3.json')
    expect(requests.some(path => path.startsWith('/api/'))).toBe(false)
    expect(unexpectedOrigins).toEqual([])
    expect(errors).toEqual([])

    const cityPage = await context.newPage()
    const cityReads: string[] = []
    const cityErrors: string[] = []
    cityPage.on('pageerror', error => cityErrors.push(error.message))
    await cityPage.route('https://1f3d9.com/api/**', async route => {
      const url = new URL(route.request().url())
      cityReads.push(url.href)
      if (url.pathname === '/api/window') {
        const replay = JSON.parse(await readFile('public/fixtures/replay-24h.json', 'utf8')) as { map: { places: unknown[] } }
        await route.fulfill({ json: { view: 'directory', places: replay.map.places } })
      } else if (url.pathname === '/api/residents') {
        const pageNumber = url.searchParams.has('before_id') ? 2 : 1
        await route.fulfill({ path: resolve(`public/fixtures/residents-presence-page${pageNumber}.json`) })
      } else if (url.pathname === '/api/changes' && !url.searchParams.has('since')) {
        await route.fulfill({ json: { change_marker: '100297' } })
      } else if (url.pathname === `/api/place/${namedPlace}`) {
        await route.fulfill({ status: 404, json: {} })
      } else if (url.pathname.startsWith('/api/drawing/') || url.pathname.startsWith('/api/thing/')) {
        await route.fulfill({ status: 404, json: {} })
      } else {
        await route.fulfill({ path: resolve('public/fixtures/changes-live.json') })
      }
    })
    await cityPage.goto(`${origin}/live/?place=${namedPlace}`)
    await ready(cityPage)
    await expect(cityPage.locator('body')).toHaveAttribute('data-live-room', namedPlace)
    expect(cityReads.length).toBeGreaterThan(4)
    expect(cityReads.every(url => url.startsWith('https://1f3d9.com/api/'))).toBe(true)
    expect(cityErrors).toEqual([])
    expect(unexpectedOrigins).toEqual([])
    await cityPage.close()
  } finally {
    await context.close()
    await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()))
  }
})

async function serveBuiltLivePage(): Promise<Server> {
  const dist = resolve('dist')
  const contentTypes: Readonly<Record<string, string>> = {
    '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.map': 'application/json',
  }
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      if (pathname === '/live') {
        const search = new URL(request.url ?? '/', 'http://localhost').search
        response.writeHead(308, { location: `/live/${search}` }).end()
        return
      }
      if (!pathname.startsWith('/live/')) throw new Error('path is outside /live/')
      const relative = pathname.slice('/live/'.length)
      const root = dist
      const suffix = relative || 'index.html'
      const file = resolve(root, suffix)
      if (file !== root && !file.startsWith(`${root}${sep}`)) throw new Error('path leaves the static root')
      const info = await stat(file)
      if (!info.isFile()) throw new Error('path is not a file')
      response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' })
      response.end(await readFile(file))
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
    }
  })
  await new Promise<void>((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => accept())
  })
  return server
}
