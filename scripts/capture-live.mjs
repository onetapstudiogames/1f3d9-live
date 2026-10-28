import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { waitForStablePicture } from './picture-settlement.mjs'
import { fetchCurrentPlaces } from '../src/city/current.ts'
import { roomFactsLinks } from '../src/room-facts-links.ts'
import { fetchCensus, fetchPlaceOutline } from '../src/city/api.ts'
import { publicPlaceIds } from '../src/room-view.ts'
import { residentNamePlate } from '../src/city/residents.ts'

const args = process.argv.slice(2)
const roomLinks = args.length === 2 && args[0] === '--feature' && args[1] === 'room-links'
const activity = args.length === 2 && args[0] === '--feature' && args[1] === 'public-activity'
if (args.length && !roomLinks && !activity) {
  throw new Error('Usage: node scripts/capture-live.mjs [--feature room-links|public-activity]')
}
const address = new URL('http://localhost:4173/')
let selectedResident = null
if (roomLinks) {
  const places = await fetchCurrentPlaces('')
  const parentIds = [...new Set(places.map(place => place.parent_id).filter(id => id !== null))].sort((a, b) => a - b)
  const candidates = parentIds.map(id => ({ id, links: roomFactsLinks(places, id, () => true) }))
    .filter(candidate => candidate.links?.parent && candidate.links.parent !== 'unavailable' && candidate.links.children.length)
  const selected = candidates.find(candidate => candidate.links.children.length <= 3) ?? candidates[0]
  if (!selected) throw new Error('No current public room with a parent and children was found.')
  address.searchParams.set('place', String(selected.id))
}
if (activity) {
  const [places, census] = await Promise.all([fetchCurrentPlaces(''), fetchCensus('')])
  const publicIds = publicPlaceIds(places)
  const occupants = id => census.filter(row => !row.asleep && row.current_place_id === id).length
  const candidates = census.filter(row => !row.asleep && residentNamePlate(row.handle)
    && row.last_active && publicIds.has(row.current_place_id))
    .sort((a, b) => occupants(a.current_place_id) - occupants(b.current_place_id) || a.id - b.id)
  for (const candidate of candidates.slice(0, 20)) {
    const outline = await fetchPlaceOutline(candidate.current_place_id, '')
    if (!outline?.lastActive || outline.quiet || outline.things.length > 10) continue
    selectedResident = candidate
    address.searchParams.set('resident', String(candidate.id))
    break
  }
  if (!selectedResident) throw new Error('No current public resident and room with activity bands were found.')
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

async function openActivityPanels(page) {
  // The existing name hit area follows its figure, including when its short name needs no reveal.
  const point = await page.locator('.room-name-hit').evaluateAll((nodes, handle) => {
    const label = nodes.find(node => node.title === handle)
    if (!label) return null
    return { x: parseFloat(label.style.left) + parseFloat(label.style.width) / 2,
      y: parseFloat(label.style.top) - 33 }
  }, residentNamePlate(selectedResident.handle))
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('The selected resident is not drawn.')
  await page.locator('#app canvas').click({ position: point })
  await page.locator('#item-panel').waitFor({ state: 'visible' })
  await page.locator('#room-facts > summary').focus()
  await page.keyboard.press('Enter')
  await page.locator('#room-last-active').waitFor({ state: 'visible' })
  await stablePicture(page)
  // Reposition the open panel after the disclosure changes the available room height.
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
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
  if (activity) await openActivityPanels(page)
  if (roomLinks) {
    await page.locator('#room-facts > summary').click()
    await page.locator('#room-parent a').waitFor({ state: 'visible' })
    await page.locator('#room-children a').first().waitFor({ state: 'visible' })
    await stablePicture(page)
  }
  await mkdir('docs/screenshots', { recursive: true })
  const prefix = activity ? 'last-active' : roomLinks ? 'room-links' : 'pr-4-live'
  await page.screenshot({ path: `docs/screenshots/${prefix}-desktop.png` })
  await page.setViewportSize({ width: 375, height: 812 })
  if (activity) {
    await page.reload()
    await page.waitForFunction(() => document.body.dataset.liveReady === 'true', null, { timeout: 60_000 })
  }
  await stablePicture(page)
  if (activity) await openActivityPanels(page)
  await page.screenshot({ path: `docs/screenshots/${prefix}-phone.png` })
  const roomId = await page.locator('body').getAttribute('data-live-room')
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), ...state, roomId,
    feature: activity ? 'public-activity' : roomLinks ? 'room-links' : null,
    ...(activity ? { residentId: selectedResident.id, residentFacts: await page.locator('#item-panel-facts').innerText(),
      roomActivity: await page.locator('#room-last-active').innerText() } : {}), failed }))
} finally {
  await browser.close()
}
