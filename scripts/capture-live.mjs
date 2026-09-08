import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { waitForStablePicture } from './picture-settlement.mjs'

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
  await page.goto('http://localhost:4173/')
  await page.waitForFunction(() => ['true', 'error'].includes(document.body.dataset.liveReady), null, { timeout: 60_000 })
  const state = await page.evaluate(() => ({ ready: document.body.dataset.liveReady,
    room: document.querySelector('#room-name').textContent, status: document.querySelector('#live-status').textContent }))
  if (state.ready !== 'true') throw new Error(JSON.stringify({ state, failed }))
  await stablePicture(page)
  await mkdir('docs/screenshots', { recursive: true })
  await page.screenshot({ path: 'docs/screenshots/pr-1-live-desktop.png' })
  await page.setViewportSize({ width: 375, height: 812 })
  await stablePicture(page)
  await page.screenshot({ path: 'docs/screenshots/pr-1-live-phone.png' })
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), ...state, failed }))
} finally {
  await browser.close()
}
