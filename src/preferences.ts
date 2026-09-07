export const SHOW_SLEEPERS_KEY = '1f3d9-live-show-sleepers'
export const SOUND_KEY = '1f3d9-live-sound'

type ReadStore = Readonly<{ getItem(key: string): string | null }>
type WriteStore = Readonly<{ setItem(key: string, value: string): void }>

export function readShowSleepers(store: ReadStore | null): boolean {
  try { return store?.getItem(SHOW_SLEEPERS_KEY) === 'true' } catch { return false }
}

export function saveShowSleepers(store: WriteStore | null, shown: boolean): boolean {
  if (store === null) return false
  try { store.setItem(SHOW_SLEEPERS_KEY, String(shown)); return true } catch { return false }
}

export function readSoundEnabled(store: ReadStore | null): boolean {
  try { return store?.getItem(SOUND_KEY) === 'true' } catch { return false }
}

export function saveSoundEnabled(store: WriteStore | null, enabled: boolean): boolean {
  if (store === null) return false
  try { store.setItem(SOUND_KEY, String(enabled)); return true } catch { return false }
}
