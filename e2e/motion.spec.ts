import { expect, test, type Page, type Route } from '@playwright/test'

const now = '2026-09-08T12:00:00.000Z'
const wallNow = '2026-09-08T12:01:00.000Z'
const actor = { id: 101, handle: 'walker', model: 'fixture', joined_at: '2026-01-01T00:00:00.000Z', has_drawing: false, current_place_id: 2, asleep: false }
const places = [
  { id: 1, name: 'Hall', parent_id: null, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 2, name: 'Source', parent_id: 1, owner: null, owner_id: null, quiet: false, has_drawing: false },
  { id: 3, name: 'Destination', parent_id: 1, owner: null, owner_id: null, quiet: false, has_drawing: false },
]
const replay = {
  span: '1h', window_start: '2026-09-08T11:00:00.000Z', window_end: now, checkpoint: '10', complete: true, row_ceiling: 200,
  map: { places }, start: { walker: { origin_event_id: 1, place_id: 2 } }, counts: {}, timeline: [],
}
const census = { residents: [actor], returned_items: 1, has_more: false, next_before_id: null }

type Motion = {
  id: number; x: number; y: number; placeId: number | null; phase: string; walking: boolean; speed: number
  door?: { x: number; y: number }; path?: readonly { x: number; y: number }[]
}
type Figure = { id: number; x: number; y: number }

async function fixture(page: Page, event: Record<string, unknown>, note?: string): Promise<{
  release: () => void; diagnostics: { external: string[]; errors: string[] }
}> {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let firstChanges = true
  const external: string[] = []; const errors: string[] = []
  const fixtureOrigin = new URL(test.info().project.use.baseURL!).origin
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== fixtureOrigin) { external.push(url.href); await route.abort(); return }
    await route.fallback()
  })
  await page.route('**/motion-replay.json', route => json(route, replay))
  await page.route('**/motion-census-page1.json', route => json(route, census))
  await page.route('**/motion-changes.json', async route => {
    if (firstChanges) {
      firstChanges = false
      await held
      await json(route, { change_marker: '11', next_since: '11', has_more: false, unchanged: false, returned_items: 1, changes: [event] })
    } else await json(route, { change_marker: '11', next_since: '11', has_more: false, unchanged: true, returned_items: 0, changes: [] })
  })
  await page.route('**/motion-notes/note-501.json', route => note
    ? json(route, { note: { id: 501, author: 'walker', body: note, place_id: 2 } })
    : json(route, {}, 404))
  return { release, diagnostics: { external, errors } }
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function readyAndFollow(page: Page, release: () => void): Promise<void> {
  await page.goto('/?replay=/motion-replay.json&census=/motion-census-page1.json&changes=/motion-changes.json&notes=/motion-notes')
  await expect.poll(async () => {
    await page.clock.runFor(16)
    return await page.locator('body').getAttribute('data-live-ready')
  }, { timeout: 30_000 }).toBe('true')
  await page.locator('#follow-picker').selectOption('101')
  await expect(page.locator('body')).toHaveAttribute('data-live-room', '2')
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
  await readyAndFollow(page, setup.release)

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

test('Pause finishes the current sentence, freezes it, and resumes the next sentence', async ({ page }) => {
  test.setTimeout(60_000)
  await page.clock.install({ time: new Date(now) })
  await page.clock.pauseAt(new Date(wallNow))
  const body = 'First sentence. Second sentence.'
  const setup = await fixture(page, { change_id: '11', kind: 'note', actor: 'walker', created_at: wallNow,
    detail: { note_id: 501, place_id: 2 } }, body)
  await readyAndFollow(page, setup.release)
  const card = page.locator('.room-speech-card[data-note-id="501"]')
  let partial: string | null = null
  for (let step = 0; step < 40; step += 1) {
    await page.clock.runFor(50)
    const revealed = await card.getAttribute('data-revealed')
    if (revealed?.startsWith('First') && revealed !== 'First sentence.') { partial = revealed; break }
  }
  expect(partial).toMatch(/^First/)
  await page.locator('#pause').click()
  let drained: { revealed: string | null; paused: string | null } | null = null
  for (let step = 0; step < 60; step += 1) {
    await page.clock.runFor(50)
    const state = { revealed: await card.getAttribute('data-revealed'), paused: await page.locator('body').getAttribute('data-live-paused') }
    if (state.revealed === 'First sentence.' && state.paused === 'true') { drained = state; break }
  }
  expect(drained).toEqual({ revealed: 'First sentence.', paused: 'true' })
  const frozen = { revealed: await card.getAttribute('data-revealed'), elapsed: Number(await page.locator('body').getAttribute('data-live-elapsed')) }
  await page.clock.runFor(2_000)
  expect(await card.getAttribute('data-revealed')).toBe(frozen.revealed)
  expect(Number(await page.locator('body').getAttribute('data-live-elapsed'))).toBe(frozen.elapsed)

  await page.locator('#pause').click()
  await expect(page.locator('body')).toHaveAttribute('data-live-paused', 'false')
  let resumed: string | null = null
  for (let step = 0; step < 40; step += 1) {
    await page.clock.runFor(50)
    const revealed = await card.getAttribute('data-revealed')
    if ((revealed?.length ?? 0) > 'First sentence.'.length) { resumed = revealed; break }
  }
  expect(resumed).toMatch(/^First sentence\. /)
  expect(setup.diagnostics).toEqual({ external: [], errors: [] })
})
