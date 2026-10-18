import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { compileMutes, FOUNDER_RESIDENT_ID, hiddenByMutes, hiddenPlaces } from '../src/browser-mutes.ts'
import { hiddenResidents } from '../src/live-mutes.ts'
import { roomDrawingHidden } from '../src/mute-view.ts'

// The docs that describe the browser's mute list must say what the page does. Each check
// below pairs the documented sentence with the rule it describes.
const doc = async (file: string): Promise<string> =>
  (await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).replace(/\s+/gu, ' ')

const FOUNDER_PLACE_RULE = 'a mute on a place the founder owns keeps the place, its drawing, and the founder, and hides only the others inside it'

test('a mute on a founder-owned place hides the others inside it and keeps the founder and the drawing', () => {
  const rules = compileMutes([{ type: 'place', id: 3, choice: 'mute' }])
  const rooms = hiddenPlaces(rules, [{ id: 2, parent_id: null }, { id: 3, parent_id: 2 }])
  const hidden = hiddenResidents(rules, rooms, [{ id: FOUNDER_RESIDENT_ID, placeId: 3 }, { id: 34, placeId: 3 }])
  assert.deepEqual([...hidden], [34])
  assert.equal(hiddenByMutes({ type: 'note', id: 7, author_id: 34, place_id: 3 }, rules, rooms), true)
  assert.equal(hiddenByMutes({ type: 'note', id: 8, author_id: FOUNDER_RESIDENT_ID, place_id: 3 }, rules, rooms), false)
  assert.equal(roomDrawingHidden(rules, rooms, { id: 3, owner_id: FOUNDER_RESIDENT_ID }), false)
})

for (const file of ['README.md', 'docs/PLAN.md']) {
  test(`${file} states the founder-owned place rule the code follows`, async () => {
    const text = await doc(file)
    assert.ok(text.includes(FOUNDER_PLACE_RULE), `${file} should say: ${FOUNDER_PLACE_RULE}`)
    assert.ok(!/founder[^.]*changes nothing/u.test(text), `${file} must not say a mute on what the founder owns changes nothing`)
  })
}

// A storage event redraws the shown room, which may read its drawing again as a room
// change does; no doc may promise that it reads nothing.
for (const file of ['README.md', 'docs/PLAN.md', 'docs/CITY-API.md']) {
  test(`${file} says a change to the list may read the shown room's drawing again`, async () => {
    const text = await doc(file)
    assert.ok(/may read (the shown|that) room's drawing again/u.test(text), `${file} should say the redraw may read the room's drawing`)
    assert.ok(!text.includes('without reading the city'), `${file} must not say a storage event reads nothing`)
    assert.ok(!text.includes('the page adds no read for it'), `${file} must not say the list adds no read`)
  })
}
