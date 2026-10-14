import {
  INITIAL_SEASON_READ,
  LIVE_TOKEN_NAMES,
  SEASON_CHECK_MS,
  parseSeason,
  seasonAssetUrl,
  seasonReadDue,
  seasonUrl,
  sloganNodes,
  type LiveSeason,
  type SeasonReadState,
  type SloganNode,
} from './city/season.ts'

// Dresses the frame for the city's season: the six frame tokens, the skyline
// icon and the slogan words in the header. The room picture never changes.

const READ_TIMEOUT_MS = 15_000

function wordImage(node: Extract<SloganNode, { kind: 'word' }>): HTMLImageElement {
  const image = document.createElement('img')
  image.className = 'season-word'
  image.src = node.src
  image.alt = node.alt
  image.width = node.width
  image.height = node.height
  image.decoding = 'async'
  image.style.height = `${node.heightEm}em`
  image.style.verticalAlign = `${-node.dropEm}em`
  return image
}

export function applySeason(season: LiveSeason, search: string): void {
  const root = document.documentElement.style
  for (const name of LIVE_TOKEN_NAMES) {
    const value = season.tokens?.[name]
    if (value) root.setProperty(name, value)
    else root.removeProperty(name)
  }
  const icon = document.getElementById('season-icon') as HTMLImageElement | null
  const slogan = document.getElementById('season-slogan')
  const nodes = sloganNodes(season, search)
  if (icon) {
    if (season.icon.dressed) {
      icon.src = seasonAssetUrl(season.icon.url, search)
      icon.alt = season.icon.label
      icon.hidden = false
    } else {
      icon.hidden = true
      icon.removeAttribute('src')
      icon.alt = ''
    }
  }
  if (slogan) {
    slogan.replaceChildren(...nodes.map(node => node.kind === 'text' ? document.createTextNode(node.text) : wordImage(node)))
    slogan.hidden = nodes.length === 0
  }
  document.body.dataset['liveSeason'] = season.date
  document.body.dataset['liveSeasonDressed'] = String(season.icon.dressed)
}

async function readSeason(url: string): Promise<LiveSeason | null> {
  const response = await fetch(url, {
    credentials: 'omit', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  })
  if (!response.ok) return null
  return parseSeason(await response.json())
}

// Reads the theme at start without delaying the first picture, then again when
// the served UTC day ends (checked every 30 seconds and on return to the tab).
// A failed or unexpected read keeps the current look and is never a read issue.
export function startSeason(search: string = window.location.search): void {
  const url = seasonUrl(search)
  if (!url) return
  let state: SeasonReadState = INITIAL_SEASON_READ
  let reading = false
  const check = async (): Promise<void> => {
    const now = Date.now()
    if (reading || !seasonReadDue(state, now)) return
    reading = true
    let season: LiveSeason | null = null
    try { season = await readSeason(url) } catch { season = null }
    reading = false
    if (season) applySeason(season, search)
    state = Object.freeze({ lastAttemptAt: now, nextChangeAt: season ? season.nextChangeAt : null })
  }
  void check()
  window.setInterval(() => { void check() }, SEASON_CHECK_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
}
