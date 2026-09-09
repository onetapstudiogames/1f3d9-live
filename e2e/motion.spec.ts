import { expect, test, type Page } from '@playwright/test'
import { advanceToLivePoll, json, liveFixtureUrl } from './live-fixture.ts'

const now = '2026-09-08T12:00:00.000Z'
const wallNow = '2026-09-08T12:01:00.000Z'
const actor = { id: 101, handle: 'walker', model: 'fixture', joined_at: '2026-01-01T00:00:00.000Z', has_drawing: false, current_place_id: 2, asleep: false }
const places = [
  { id: 1, name: 'Hall', parent_id: null, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 2, name: 'Source', parent_id: 1, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 3, name: 'Destination', parent_id: 1, owner: null, owner_id: null, quiet: false, has_drawing: false },
]
const census = { residents: [actor], returned_items: 1, has_more: false, next_before_id: null }

type Motion = {
  id: number; x: number; y: number; placeId: number | null; phase: string; walking: boolean; speed: number
  door?: { x: number; y: number }; path?: readonly { x: number; y: number }[]
}
type Figure = { id: number; x: number; y: number }
type Thing = { id: number; x: number; y: number; effect?: string | null; glowing?: boolean }
type ActionMotion = {
  residentId: number; thingId: number; phase: 'approach' | 'shake'; x: number; y: number
  thingX: number; thingY: number; offsetX: number; speed: number
}

async function fixture(page: Page, event: Record<string, unknown>, note?: string): Promise<{
  release: () => void; requested: Promise<void>; diagnostics: { external: string[]; errors: string[] }
}> {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let firstChanges = true
  let changeRequested!: () => void
  const requested = new Promise<void>(resolve => { changeRequested = resolve })
  const external: string[] = []; const errors: string[] = []
  const fixtureOrigin = new URL(test.info().project.use.baseURL!).origin
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== fixtureOrigin) { external.push(url.href); await route.abort(); return }
    await route.fallback()
  })
  await page.route('**/motion-map.json', route => json(route, { view: 'directory', places }))
  await page.route('**/motion-cursor.json', route => json(route, { change_marker: '10' }))
  await page.route('**/motion-census-page1.json', route => json(route, census))
  await page.route('**/motion-changes.json', async route => {
    changeRequested()
    if (firstChanges) {
      firstChanges = false
      await held
      await json(route, { change_marker: '11', next_since: '11', has_more: false, unchanged: false, returned_items: 1, changes: [event] })
    } else await json(route, { change_marker: '11', next_since: '11', has_more: false, unchanged: true, returned_items: 0, changes: [] })
  })
  await page.route('**/motion-notes/note-501.json', route => note
    ? json(route, { note: { id: 501, author: 'walker', body: note, place_id: 2 } })
    : json(route, {}, 404))
  await page.route('**/motion-places/place-2.json', route => json(route, {
    view: 'outline', place: { ...places[1], laws: [] },
    things: [{ id: 701, name: 'brass bell', place_id: 2, owner: 'walker', owner_id: 101,
      current_owner: 'walker', current_owner_id: 101, made_by: 'walker', maker_id: 101,
      kind: null, kind_id: null, birth_revision: null, current_revision: null, body_text_bytes: 0,
      open_to_use: true, has_drawing: false, created_at: '2026-09-01T00:00:00.000Z' }],
    things_page: { total_items: 1, returned_items: 1, has_more: false, next_before_thing_id: null },
  }))
  await page.route('**/motion-drawings/thing-701.json', route => json(route, {}, 404))
  await page.route('**/motion-drawings/resident-101.json', route => json(route, {}, 404))
  return { release, requested, diagnostics: { external, errors } }
}

async function readyAndFollow(page: Page, release: () => void, requested: Promise<void>): Promise<void> {
  const params = liveFixtureUrl.replace('/?', '/?map=/motion-map.json&cursor=/motion-cursor.json&')
    .replace('census=/fixtures/residents-presence-page1.json', 'census=/motion-census-page1.json')
    .replace('map=/fixtures/map-current-page1.json&', '').replace('cursor=/fixtures/change-cursor.json&', '')
    .replace('changes=/fixtures/changes-live.json', 'changes=/motion-changes.json')
    .replace('places=/fixtures/places', 'places=/motion-places')
    .concat('&notes=/motion-notes&drawings=/motion-drawings')
  await page.goto(params)
  await expect.poll(async () => {
    await page.clock.runFor(16)
    return await page.locator('body').getAttribute('data-live-ready')
  }, { timeout: 30_000 }).toBe('true')
  await page.locator('#follow-picker').selectOption('101')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '2')
  await advanceToLivePoll(page)
  await requested
  release()
  await expect(page.locator('body')).toHaveAttribute('data-live-poll', 'true')
}

async function motion(page: Page): Promise<Motion | null> {
  return page.evaluate(() => {
    const rows = JSON.parse(document.body.dataset['liveMotion'] ?? '[]') as Motion[]
    return rows.find(row => row.id === 101) ?? null
  })
}

async function figure(page: Page): Promise<Figure | null> {
  return page.evaluate(() => {
    const rows = JSON.parse(document.body.dataset['liveFigures'] ?? '[]') as Figure[]
    return rows.find(row => row.id === 101) ?? null
  })
}

async function thing(page: Page): Promise<Thing | null> {
  return page.evaluate(() => {
    const rows = JSON.parse(document.body.dataset['liveThings'] ?? '[]') as Thing[]
    return rows.find(row => row.id === 701) ?? null
  })
}

async function actionMotion(page: Page): Promise<ActionMotion | null> {
  return page.evaluate(() => {
    const rows = JSON.parse(document.body.dataset['liveActionMotion'] ?? '[]') as ActionMotion[]
    return rows.find(row => row.residentId === 101 && row.thingId === 701) ?? null
  })
}

function nearestLeg(point: { x: number; y: number }, path: readonly { x: number; y: number }[]): number {
  let nearest = -1; let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index]!; const end = path[index + 1]!
    const dx = end.x - start.x; const dy = end.y - start.y
    const fraction = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)))
    const distance = Math.hypot(point.x - (start.x + dx * fraction), point.y - (start.y + dy * fraction))
    if (distance < nearestDistance) { nearest = index; nearestDistance = distance }
  }
  return nearest
}

test('a followed live move exits at 140 CSS px/sec, switches rooms, and arrives door to free target', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.clock.install({ time: new Date(now) })
  await page.clock.pauseAt(new Date(wallNow))
  const setup = await fixture(page, { change_id: '11', kind: 'action', actor: 'walker', created_at: wallNow,
    detail: { action: 'move', action_id: 11, status: 'applied', from_place_id: 2, to_place_id: 3 } })
  await readyAndFollow(page, setup.release, setup.requested)

  await expect.poll(async () => { await page.clock.runFor(16); return (await motion(page))?.phase }).toBe('departure')
  const samples: Array<{ elapsed: number; motion: Motion; figure: Figure; room: string | null }> = []
  let entered: Motion | null = null
  for (let elapsed = 0; elapsed < 4_000; elapsed += 250) {
    await page.clock.runFor(250)
    const current = await motion(page); const drawn = await figure(page)
    if (current?.phase === 'departure' && drawn) samples.push({ elapsed, motion: current, figure: drawn,
      room: await page.locator('body').getAttribute('data-live-room') })
    if (current?.phase === 'arrival') entered = current
    if (current?.phase !== 'departure') break
  }
  expect(samples.length).toBeGreaterThanOrEqual(3)
  expect(new Set(samples.map(sample => sample.motion.placeId))).toEqual(new Set([2]))
  for (const sample of samples) {
    expect(Math.abs(sample.figure.x - sample.motion.x)).toBeLessThanOrEqual(3)
    expect(Math.abs(sample.figure.y - sample.motion.y)).toBeLessThanOrEqual(3)
    expect(sample.motion.speed).toBe(140)
    expect(sample.room).toBe('2')
  }
  const paces = samples.slice(1).flatMap((sample, index) => {
    const previous = samples[index]!
    const path = sample.motion.path ?? []
    if (path.length < 2 || nearestLeg(previous.motion, path) !== nearestLeg(sample.motion, path)) return []
    const distance = Math.hypot(sample.motion.x - previous.motion.x, sample.motion.y - previous.motion.y)
    return [distance / ((sample.elapsed - previous.elapsed) / 1_000)]
  })
  expect(paces.filter(pace => Math.abs(pace - 140) <= 5).length).toBeGreaterThanOrEqual(2)

  expect(entered?.phase).toBe('arrival')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '3')
  expect(entered?.placeId).toBe(3)
  expect(entered?.path?.length).toBeGreaterThanOrEqual(3)
  expect(entered?.path).toContainEqual(entered?.door)
  const outside = entered!.path![0]!; const door = entered!.door!
  const firstLeg = { x: door.x - outside.x, y: door.y - outside.y }
  const progress = ((entered!.x - outside.x) * firstLeg.x + (entered!.y - outside.y) * firstLeg.y)
    / (firstLeg.x * firstLeg.x + firstLeg.y * firstLeg.y)
  expect(progress).toBeGreaterThanOrEqual(0)
  expect(progress).toBeLessThan(1)
  expect(Math.hypot(entered!.x - outside.x, entered!.y - outside.y)).toBeLessThanOrEqual(140 * 0.25 + 3)
  let settled: Motion | null = null
  for (let step = 0; step < 120; step += 1) {
    await page.clock.runFor(50)
    const current = await motion(page)
    if (current?.phase === 'done') { settled = current; break }
  }
  expect(settled?.phase).toBe('done')
  expect(settled?.placeId).toBe(3)
  expect(settled).toMatchObject(entered?.path?.at(-1) ?? {})
  expect(Math.hypot(settled!.x - entered!.door!.x, settled!.y - entered!.door!.y)).toBeGreaterThan(20)
  expect(settled?.walking).toBe(false)
  expect(setup.diagnostics).toEqual({ external: [], errors: [] })
})

test('a witnessed use walks to the visible thing, shakes both sprites under its caption, and settles beside it', async ({ page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.clock.install({ time: new Date(now) })
  await page.clock.pauseAt(new Date(wallNow))
  const setup = await fixture(page, { change_id: '11', kind: 'action', actor: 'walker', created_at: wallNow,
    detail: { action: 'use', action_id: 12, status: 'applied', source_thing_id: 701, place_id: 2 } })
  await readyAndFollow(page, setup.release, setup.requested)

  await expect.poll(async () => { await page.clock.runFor(16); return (await actionMotion(page))?.phase }).toBe('approach')
  const approach: Array<{ elapsed: number; action: ActionMotion; figure: Figure }> = []
  for (let elapsed = 0; elapsed < 4_000; elapsed += 100) {
    const action = await actionMotion(page); const drawn = await figure(page)
    if (action?.phase !== 'approach') break
    expect(drawn).not.toBeNull()
    approach.push({ elapsed, action, figure: drawn! })
    await page.clock.runFor(100)
  }
  expect(approach.length).toBeGreaterThanOrEqual(3)
  for (const sample of approach) {
    expect(sample.action.speed).toBe(140)
    expect(sample.action.offsetX).toBe(0)
    expect(sample.figure.x).toBeCloseTo(sample.action.x, 0)
    expect(Math.abs(sample.figure.y - sample.action.y)).toBeLessThanOrEqual(2.01)
  }
  const approachPaces = approach.slice(1).map((sample, index) => {
    const previous = approach[index]!
    return Math.hypot(sample.action.x - previous.action.x, sample.action.y - previous.action.y)
      / ((sample.elapsed - previous.elapsed) / 1_000)
  })
  expect(approachPaces.filter(pace => Math.abs(pace - 140) <= 8).length).toBeGreaterThanOrEqual(2)

  await expect.poll(async () => { await page.clock.runFor(16); return (await actionMotion(page))?.phase }).toBe('shake')
  const caption = page.locator('.room-action-caption[data-resident-id="101"]')
  await expect(caption).toHaveText('used a brass bell')
  await expect(caption).toHaveCSS('background-color', 'rgb(255, 243, 214)')
  await page.screenshot({ path: test.info().outputPath('witnessed-use.png') })
  const shakeSamples: Array<{ action: ActionMotion; figure: Figure; thing: Thing; captionX: number }> = []
  for (let elapsed = 0; elapsed < 1_000; elapsed += 100) {
    await page.clock.runFor(100)
    const action = await actionMotion(page); const drawn = await figure(page); const shownThing = await thing(page)
    if (action?.phase === 'shake' && drawn && shownThing) shakeSamples.push({ action, figure: drawn, thing: shownThing,
      captionX: (await caption.boundingBox())?.x ?? Number.NaN })
  }
  expect(shakeSamples.length).toBeGreaterThanOrEqual(5)
  expect(new Set(shakeSamples.map(sample => Math.sign(sample.action.offsetX))).size).toBeGreaterThan(1)
  for (const sample of shakeSamples) {
    expect(sample.action.speed).toBe(0)
    expect(sample.figure.x - sample.action.x).toBeCloseTo(sample.action.offsetX, 0)
    // The thing rattles against the resident: opposite phase.
    expect(sample.thing.x - sample.action.thingX).toBeCloseTo(-sample.action.offsetX, 0)
  }
  expect(Math.max(...shakeSamples.map(sample => sample.captionX)) - Math.min(...shakeSamples.map(sample => sample.captionX))).toBeGreaterThan(1)

  await expect.poll(async () => { await page.clock.runFor(25); return actionMotion(page) }).toBeNull()
  const settledFigure = await figure(page); const settledThing = await thing(page)
  expect(settledFigure).not.toBeNull(); expect(settledThing).not.toBeNull()
  expect(Math.hypot(settledFigure!.x - settledThing!.x, settledFigure!.y - settledThing!.y)).toBeLessThanOrEqual(64)
  // The final 100ms sample can include the first idle step, plus the existing 2px bob.
  expect(Math.hypot(settledFigure!.x - shakeSamples.at(-1)!.action.x,
    settledFigure!.y - shakeSamples.at(-1)!.action.y)).toBeLessThanOrEqual(3.1)
  expect(settledThing!.x).toBeCloseTo(shakeSamples.at(-1)!.action.thingX, 0)
  expect(settledThing?.effect).toBe('glow')
  expect(setup.diagnostics).toEqual({ external: [], errors: [] })
})
