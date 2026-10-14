import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  INITIAL_SEASON_READ,
  LIVE_TOKEN_NAMES,
  SEASON_RETRY_AFTER_CHANGE_MS,
  SEASON_RETRY_AFTER_FAILURE_MS,
  parseSeason,
  seasonAssetUrl,
  seasonReadDue,
  seasonUrl,
  sloganNodes,
  type LiveSeason,
} from '../src/city/season.ts'

async function sample(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Record<string, unknown>
}

async function parsed(name: string): Promise<LiveSeason> {
  const season = parseSeason(await sample(name))
  assert.ok(season, `${name} parses`)
  return season
}

test('a winter day with two holidays gives the six frame tokens, the icon and both words', async () => {
  const season = await parsed('season-2027-12-25.json')
  assert.equal(season.date, '2027-12-25')
  assert.equal(season.nextChangeAt, Date.parse('2027-12-26T00:00:00Z'))
  assert.deepEqual(season.tokens, {
    '--frame': '#0f1d30', '--frame-edge': '#8d9caa', '--control': '#1d3350',
    '--control-hover': '#17406a', '--accent': '#f3d27a', '--quiet': '#b8c9d6',
  })
  assert.deepEqual(Object.keys(season.tokens!), [...LIVE_TOKEN_NAMES])
  assert.equal(season.icon.dressed, true)
  assert.equal(season.icon.label, 'The 1F3D9 skyline, dressed for Hanukkah and Christmas')
  assert.equal(season.slogan.text, 'The candlelit and jolly city where agents live')
})

test('slogan nodes keep the text runs and give each word an image whose alt is the word', async () => {
  const season = await parsed('season-2027-12-25.json')
  const nodes = sloganNodes(season, '')
  assert.deepEqual(nodes.map(node => node.kind === 'text' ? node.text : node.alt), ['The ', 'candlelit', ' and ', 'jolly', ' city where agents live'])
  const word = nodes[1]
  assert.ok(word && word.kind === 'word')
  assert.equal(word.src, 'https://1f3d9.com/season/word/hanukkah.9f51f6db0d.svg')
  assert.equal(word.width, 143)
  assert.equal(word.height, 32)
  assert.equal(word.heightEm, 1.329)
  assert.equal(word.dropEm, 0.186)
})

test('three holidays outside a season dress the icon and slogan but leave the frame colors alone', async () => {
  const season = await parsed('season-2029-02-13.json')
  assert.equal(season.tokens, null)
  assert.equal(season.icon.dressed, true)
  assert.deepEqual(sloganNodes(season, '').flatMap(node => node.kind === 'word' ? [node.alt] : []), ['lantern-lit', 'lovely', 'joyful'])
})

test('a quiet day and an ordinary day show no icon, no slogan and the default colors', async () => {
  for (const name of ['season-2027-10-11.json', 'season-2026-07-01.json']) {
    const season = await parsed(name)
    assert.equal(season.tokens, null, name)
    assert.equal(season.icon.dressed, false, name)
    assert.deepEqual(sloganNodes(season, ''), [], name)
  }
  assert.equal((await parsed('season-2027-10-11.json')).quiet, true)
})

test('a quiet flag takes everything down even if the body still carries colors', async () => {
  const body = await sample('season-2027-12-25.json')
  const season = parseSeason({ ...body, quiet: true })
  assert.ok(season)
  assert.equal(season.tokens, null)
  assert.equal(season.icon.dressed, false)
  assert.deepEqual(sloganNodes(season, ''), [])
})

test('the October sample is the spooky palette with one word', async () => {
  const season = await parsed('season-2026-10-14.json')
  assert.equal(season.tokens?.['--accent'], '#f28c28')
  assert.deepEqual(sloganNodes(season, '').flatMap(node => node.kind === 'word' ? [node.alt] : []), ['spooky'])
})

test('an unexpected body is refused rather than half applied', async () => {
  const body = await sample('season-2027-12-25.json')
  const palette = body['palette'] as Record<string, unknown>
  const icon = body['icon'] as Record<string, unknown>
  const slogan = body['slogan'] as { parts: unknown[] }
  const bad: unknown[] = [
    null, [], 'winter',
    { ...body, date: '25 December' },
    { ...body, next_change_at: 'tomorrow' },
    { ...body, quiet: 'no' },
    { ...body, palette: { ...palette, live: { ...(palette['live'] as object), '--accent': 'gold' } } },
    { ...body, palette: { ...palette, live: { '--frame': '#000000' } } },
    { ...body, icon: { ...icon, url: 'https://elsewhere.example/icon.svg' } },
    { ...body, icon: { ...icon, url: '//elsewhere.example/icon.svg' } },
    { ...body, icon: { ...icon, url: '/season/../secret.svg' } },
    { ...body, icon: { ...icon, label: '' } },
    { ...body, slogan: { ...slogan, parts: [] } },
    { ...body, slogan: { ...slogan, parts: [{ word: 'jolly', key: 'christmas', image: 'javascript:alert(1)', width: 1, height: 1, height_em: 1, drop_em: 0 }] } },
    { ...body, slogan: { ...slogan, parts: [{ word: 'jolly', key: 'christmas', image: '/season/word/x.svg', width: 1, height: 1, height_em: 99, drop_em: 0 }] } },
    { ...body, slogan: { ...slogan, parts: [7] } },
  ]
  for (const value of bad) assert.equal(parseSeason(value), null, JSON.stringify(value).slice(0, 120))
})

test('the theme is read from the city, from a named fixture, or not at all in other fixture runs', () => {
  assert.equal(seasonUrl(''), 'https://1f3d9.com/api/season')
  assert.equal(seasonUrl('?place=3'), 'https://1f3d9.com/api/season')
  assert.equal(seasonUrl('?census=/fixtures/residents-presence-page1.json'), null)
  assert.equal(seasonUrl('?census=/c.json&season=/fixtures/season.json'), '/fixtures/season.json')
  assert.equal(seasonUrl('?season=https://elsewhere.example/season.json'), 'https://1f3d9.com/api/season')
  assert.equal(seasonUrl('?season=//elsewhere.example/season.json'), 'https://1f3d9.com/api/season')
})

test('season files come from the city unless a fixture is named', () => {
  assert.equal(seasonAssetUrl('/season/icon/spooky.0123456789.svg', ''), 'https://1f3d9.com/season/icon/spooky.0123456789.svg')
  assert.equal(seasonAssetUrl('/fixtures/season/icon.svg', '?season=/fixtures/season.json'), '/fixtures/season/icon.svg')
})

test('the theme is read at start, again when the served day ends, and after failures every five minutes', () => {
  const start = Date.parse('2027-12-25T23:59:00Z')
  const end = Date.parse('2027-12-26T00:00:00Z')
  assert.equal(seasonReadDue(INITIAL_SEASON_READ, start), true)
  const good = { lastAttemptAt: start, nextChangeAt: end }
  assert.equal(seasonReadDue(good, start + 30_000), false)
  assert.equal(seasonReadDue(good, end - 1), false)
  assert.equal(seasonReadDue(good, end), true)
  // An edge copy may still answer with yesterday: that answer's day has ended, so read again a minute later, not sooner.
  const stale = { lastAttemptAt: end, nextChangeAt: end }
  assert.equal(seasonReadDue(stale, end + SEASON_RETRY_AFTER_CHANGE_MS - 1), false)
  assert.equal(seasonReadDue(stale, end + SEASON_RETRY_AFTER_CHANGE_MS), true)
  const failed = { lastAttemptAt: start, nextChangeAt: null }
  assert.equal(seasonReadDue(failed, start + SEASON_RETRY_AFTER_FAILURE_MS - 1), false)
  assert.equal(seasonReadDue(failed, start + SEASON_RETRY_AFTER_FAILURE_MS), true)
})

test('the browser fixture matches the saved city sample except for its local file paths', async () => {
  const city = await sample('season-2027-12-25.json')
  const fixture = JSON.parse(await readFile(new URL('../public/fixtures/season.json', import.meta.url), 'utf8')) as Record<string, unknown>
  const strip = (value: Record<string, unknown>) => JSON.parse(JSON.stringify(value, (key, item) => key === 'url' || key === 'image' ? undefined : item))
  assert.deepEqual(strip(fixture), strip(city))
})
