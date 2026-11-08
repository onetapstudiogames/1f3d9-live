import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { advanceToLivePoll } from './live-fixture.ts'
import { clickThing, endingClock, endingRoot, endingSetId, installEndingRoom, openEndingRoom, ordinaryId, remnantId, shownThings } from './thing-endings-fixture.ts'

test('a remnant is drawn faded and its panel says it ended; a thing with an end set says when', async ({ page }) => {
  await page.clock.install({ time: endingClock })
  const diagnostics = await installEndingRoom(page)
  await openEndingRoom(page)

  await expect.poll(async () => { await page.clock.runFor(50); return (await shownThings(page)).find(row => row.id === remnantId)?.texture })
    .toBe('thing-default-remnant')
  const textures = new Map((await shownThings(page)).map(row => [row.id, row.texture]))
  expect(textures.get(endingSetId)).toBe('thing-default')
  expect(textures.get(ordinaryId)).not.toMatch(/-remnant$/)

  await clickThing(page, remnantId)
  const panel = page.locator('#item-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-thing-end', 'ended')
  await expect(page.locator('#item-panel-facts')).toContainText('Ended')
  await expect(page.locator('#item-panel-facts')).toContainText('it is a remnant now')
  await page.keyboard.press('Escape')

  await clickThing(page, endingSetId)
  await expect(panel).toHaveAttribute('data-thing-end', 'set')
  await expect(page.locator('#item-panel-facts')).toContainText('after 3 more uses')
  await expect(page.locator('#item-panel-facts')).toContainText("runs ember's end steps once: writes its own state box.")
  await page.keyboard.press('Escape')

  await clickThing(page, ordinaryId)
  await expect(panel).toBeVisible()
  await expect(panel).not.toHaveAttribute('data-thing-end', /.+/)
  await expect(page.locator('#item-panel-facts')).not.toContainText('End')
  await page.keyboard.press('Escape')

  await advanceToLivePoll(page)
  const log = page.locator('#room-activity')
  await expect(log).toContainText('the city recorded the end of a paper boat, one day long: its time limit ran out; it is a remnant now.')
  await expect(log).toContainText('1 thing ended.')
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})

test('the panel re-reads a thing with an end on every open, and an end its owner cleared drops out', async ({ page }) => {
  await page.clock.install({ time: endingClock })
  const diagnostics = await installEndingRoom(page)
  await openEndingRoom(page)
  const reads = (): number => diagnostics.thingReads.filter(id => id === endingSetId).length
  const facts = page.locator('#item-panel-facts')
  const panel = page.locator('#item-panel')
  const thingBody = JSON.parse(await readFile(`${endingRoot}/thing-40001-ending-set.json`, 'utf8')) as {
    thing: { ending: Record<string, unknown> & { conditions: Array<Record<string, unknown>> } } }
  const settle = async (): Promise<void> => { for (let step = 0; step < 5; step += 1) await page.clock.runFor(50) }

  await clickThing(page, endingSetId)
  await expect.poll(async () => { await page.clock.runFor(50); return await facts.textContent() }).toContain('after 3 more uses')
  await page.keyboard.press('Escape')
  const firstReads = reads()

  // A use spends one; the row's short status stays the same, so only a fresh read shows it.
  const used = structuredClone(thingBody)
  used.thing.ending.conditions = used.thing.ending.conditions.map(row => 'uses' in row ? { ...row, uses_left: 1 } : row)
  used.thing.ending['uses_left'] = 1
  diagnostics.serves.things.set(endingSetId, JSON.stringify(used))
  await settle()
  await clickThing(page, endingSetId)
  await expect.poll(async () => { await page.clock.runFor(50); return await facts.textContent() }).toContain('after 1 more use')
  expect(reads()).toBeGreaterThan(firstReads)
  await page.keyboard.press('Escape')

  // The owner clears the end: the row loses ends and the thing read says none is set.
  const cleared = structuredClone(thingBody)
  cleared.thing.ending = { ...cleared.thing.ending, status: 'permitted_but_unset', conditions: [], soonest_known_end: null, uses_left: null }
  diagnostics.serves.things.set(endingSetId, JSON.stringify(cleared))
  const outline = JSON.parse(await readFile(`${endingRoot}/place-498-outline.json`, 'utf8')) as { things: Array<Record<string, unknown>> }
  outline.things = outline.things.map(row => { if (row['id'] !== endingSetId) return row; const { ends: _ends, ...rest } = row; return rest })
  diagnostics.serves.outline = JSON.stringify(outline)
  const outlineReads = diagnostics.outlineReads.length
  await advanceToLivePoll(page)
  await expect.poll(async () => { await page.clock.runFor(50); return diagnostics.outlineReads.length }).toBeGreaterThan(outlineReads)
  await settle()
  await clickThing(page, endingSetId)
  await expect(panel).toBeVisible()
  await settle()
  await expect(panel).not.toHaveAttribute('data-thing-end', /.+/)
  await expect(facts).toContainText('Owner')
  await expect(facts).not.toContainText('Ends')
  await expect(facts).not.toContainText('When it ends')
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})
