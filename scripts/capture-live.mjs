import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { waitForStablePicture } from './picture-settlement.mjs'
import { fetchCurrentPlaces } from '../src/city/current.ts'
import { roomFactsLinks } from '../src/room-facts-links.ts'

const args = process.argv.slice(2)
const roomLinks = args.length === 2 && args[0] === '--feature' && args[1] === 'room-links'
if (args.length && !roomLinks) throw new Error('Usage: node scripts/capture-live.mjs [--feature room-links]')
const address = new URL('http://localhost:4173/')
if (roomLinks) {
  const places = await fetchCurrentPlaces('')
  const parentIds = [...new Set(places.map(place => place.parent_id).filter(id => id !== null))].sort((a, b) => a - b)
  const candidates = parentIds.map(id => ({ id, links: roomFactsLinks(places, id, () => true) }))
    .filter(candidate => candidate.links?.parent && candidate.links.parent !== 'unavailable' && candidate.links.children.length)
  const selected = candidates.find(candidate => candidate.links.children.length <= 3) ?? candidates[0]
  if (!selected) throw new Error('No current public room with a parent and children was found.')
  address.searchParams.set('place', String(selected.id))
}

async function stablePicture(page) {
  return waitForStablePicture(() => page.evaluate(() => ({
    settled: document.body.dataset.livePictureSettled === 'true',
    picture: {
      room: document.body.dataset.liveRoom,
      thingsCount: document.body.dataset.liveThingsCount,
      layout: document.body.dataset.liveLayoutRevision,
      width: window.innerWidth,
      height: window.innerHeight,
    },
  })))
}

// Run against the local preview with no fixture routes or city credentials.
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const failed = []
  page.on('requestfailed', request => {
    if (request.url().startsWith('https://1f3d9.com/')) failed.push({ url: request.url(), error: request.failure()?.errorText })
  })
  await page.goto(address.href)
  await page.waitForFunction(() => ['true', 'error'].includes(document.body.dataset.liveReady), null, { timeout: 60_000 })
  const state = await page.evaluate(() => ({ ready: document.body.dataset.liveReady,
    room: document.querySelector('#room-name').textContent, status: document.querySelector('#live-status').textContent }))
  if (state.ready !== 'true') throw new Error(JSON.stringify({ state, failed }))
  await stablePicture(page)
  if (roomLinks) {
    await page.locator('#room-facts > summary').click()
    await page.locator('#room-parent a').waitFor({ state: 'visible' })
    await page.locator('#room-children a').first().waitFor({ state: 'visible' })
    await stablePicture(page)
  }
  await mkdir('docs/screenshots', { recursive: true })
  const prefix = roomLinks ? 'room-links' : 'pr-4-live'
  await page.screenshot({ path: `docs/screenshots/${prefix}-desktop.png` })
  await page.setViewportSize({ width: 375, height: 812 })
  await stablePicture(page)
  await page.screenshot({ path: `docs/screenshots/${prefix}-phone.png` })
  const roomId = await page.locator('body').getAttribute('data-live-room')
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), ...state, roomId, feature: roomLinks ? 'room-links' : null, failed }))
} finally {
  await browser.close()
}
