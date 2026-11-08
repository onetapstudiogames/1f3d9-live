import { expect, test } from '@playwright/test'
import { advanceToLivePoll } from './live-fixture.ts'
import { clickThing, endingClock, endingSetId, installEndingRoom, openEndingRoom, ordinaryId, remnantId, shownThings } from './thing-endings-fixture.ts'

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
  await expect(log).toContainText('the city recorded the end of a paper boat, one day long: its time after setting ran out; it is a remnant now.')
  await expect(log).toContainText('1 thing ended.')
  expect(diagnostics.external).toEqual([]); expect(diagnostics.errors).toEqual([])
})
