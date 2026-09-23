import { expect, test, type Page } from '@playwright/test'
import { keepFixtureOffline, liveFixtureUrl } from './live-fixture.ts'

type SpritePoint = Readonly<{ id: number; x: number; y: number; name?: string | null }>

async function openFixture(page: Page): Promise<{ external: string[]; errors: string[] }> {
  const diagnostics = await keepFixtureOffline(page)
  await page.goto(liveFixtureUrl)
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', 'true', { timeout: 30_000 })
  await expect(page.locator('body')).toHaveAttribute('data-live-read-error', 'false')
  return diagnostics
}

async function visibleSprite(page: Page, kind: 'resident' | 'thing'): Promise<SpritePoint> {
  await expect.poll(() => page.evaluate(name => {
    const key = name === 'resident' ? 'liveFigures' : 'liveThings'
    return JSON.parse(document.body.dataset[key] ?? '[]').length
  }, kind)).toBeGreaterThan(0)
  return page.evaluate(name => {
    const key = name === 'resident' ? 'liveFigures' : 'liveThings'
    const rows = JSON.parse(document.body.dataset[key] ?? '[]') as SpritePoint[]
    return rows.find(row => name === 'resident' || typeof row.name === 'string')!
  }, kind)
}

async function clickSprite(page: Page, sprite: SpritePoint): Promise<void> {
  await page.locator('#app canvas').click({ position: { x: sprite.x, y: sprite.y } })
}

async function clickEmptyCanvas(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#app canvas')!
    const figures = JSON.parse(document.body.dataset['liveFigures'] ?? '[]') as Array<{ x: number; y: number }>
    const things = JSON.parse(document.body.dataset['liveThings'] ?? '[]') as Array<{ x: number; y: number }>
    for (let y = 12; y < canvas.clientHeight - 12; y += 12) {
      for (let x = 12; x < canvas.clientWidth - 12; x += 12) {
        const overFigure = figures.some(row => Math.abs(row.x - x) < 31 && Math.abs(row.y - y) < 31)
        const overThing = things.some(row => Math.abs(row.x - x) < 19 && Math.abs(row.y - y) < 19)
        if (!overFigure && !overThing) return { x, y }
      }
    }
    return { x: 10, y: 10 }
  })
  await page.locator('#app canvas').click({ position: point })
}

test('clicking a resident opens its panel and follows that same resident', async ({ page }) => {
  const diagnostics = await openFixture(page)
  const resident = await visibleSprite(page, 'resident')
  const option = page.locator(`#follow-picker option[value="${resident.id}"]`)
  const handle = (await option.textContent())!.replace(new RegExp(` · resident #${resident.id}$`), '')

  await clickSprite(page, resident)

  await expect(page.locator('#item-panel')).toBeVisible()
  await expect(page.locator('#item-panel-title')).toHaveText(handle)
  await expect(page.locator('#item-panel-id')).toHaveText(`resident #${resident.id}`)
  await expect(page.locator('#follow-picker')).toHaveValue(String(resident.id))
  await expect(page.locator('body')).toHaveAttribute('data-live-following', String(resident.id))
  await page.keyboard.press('Escape')
  await expect(page.locator('#item-panel')).toBeHidden()
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('clicking a thing opens its panel without changing either picker', async ({ page }) => {
  const diagnostics = await openFixture(page)
  const thing = await visibleSprite(page, 'thing')
  const before = {
    resident: await page.locator('#follow-picker').inputValue(),
    place: await page.locator('#place-picker').inputValue(),
  }

  await clickSprite(page, thing)

  await expect(page.locator('#item-panel')).toBeVisible()
  await expect(page.locator('#item-panel-title')).toHaveText(thing.name!)
  await expect(page.locator('#item-panel-id')).toHaveText(`Thing #${thing.id}`)
  await expect(page.locator('#follow-picker')).toHaveValue(before.resident)
  await expect(page.locator('#place-picker')).toHaveValue(before.place)
  await page.locator('#item-panel-close').click()
  await expect(page.locator('#item-panel')).toBeHidden()
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('clicking an empty part of the canvas closes the panel', async ({ page }) => {
  const diagnostics = await openFixture(page)
  await clickSprite(page, await visibleSprite(page, 'resident'))
  await expect(page.locator('#item-panel')).toBeVisible()

  await clickEmptyCanvas(page)

  await expect(page.locator('#item-panel')).toBeHidden()
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})

test('phone panel stays inside the room above the visible pickers', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const diagnostics = await openFixture(page)
  await clickSprite(page, await visibleSprite(page, 'resident'))
  const panel = await page.locator('#item-panel').boundingBox()
  const app = await page.locator('#app').boundingBox()
  const footer = await page.locator('#room-footer').boundingBox()
  const residentPicker = await page.locator('#follow-picker').boundingBox()
  const placePicker = await page.locator('#place-picker').boundingBox()

  expect(panel).not.toBeNull(); expect(app).not.toBeNull(); expect(footer).not.toBeNull()
  expect(residentPicker).not.toBeNull(); expect(placePicker).not.toBeNull()
  expect(await page.locator('#item-panel').getAttribute('data-side')).toBe('sheet')
  expect(panel!.x).toBeGreaterThanOrEqual(app!.x)
  expect(panel!.y).toBeGreaterThanOrEqual(app!.y)
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(app!.x + app!.width)
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(footer!.y)
  await expect(page.locator('#follow-picker')).toBeVisible()
  await expect(page.locator('#place-picker')).toBeVisible()
  expect(diagnostics.external).toEqual([])
  expect(diagnostics.errors).toEqual([])
})
