import type { Drawing, ReplayFile } from './types.ts'

export const CITY_ORIGIN = 'https://1f3d9.com'

// ?replay=<url> lets tests and the smoke check read a saved fixture instead of the live city.
export function replayUrl(search: string = window.location.search): string {
  const override = new URLSearchParams(search).get('replay')
  return override && override.length > 0 ? override : `${CITY_ORIGIN}/api/replay?span=24h`
}

export async function fetchReplay(url: string = replayUrl()): Promise<ReplayFile> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`the city answered ${response.status} for the replay file`)
  return await response.json() as ReplayFile
}

export async function fetchDrawing(type: 'resident' | 'place', id: number): Promise<Drawing | null> {
  const response = await fetch(`${CITY_ORIGIN}/api/drawing/${type}/${id}`, { headers: { accept: 'application/json' } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`the city answered ${response.status} for the ${type} drawing ${id}`)
  return await response.json() as Drawing
}
