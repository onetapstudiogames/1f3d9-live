import type { ReplayEvent } from './city/types.ts'
import type { Simulation } from './replay/simulation.ts'

export type Invention = Readonly<{ changeId: string; actor: string; name: string; subject: 'kind' | 'trait'; subjectId: number }>
export type InventionMoment = Readonly<{ changeId: string; residentId: number; name: string; subject: 'kind' | 'trait'; expiresAt: number }>
export type StartedInvention = Readonly<{ invention: Invention; residentId: number; expiresAt: number }>
export type InventionState = Readonly<{ moments: readonly InventionMoment[]; pending: boolean; issues: readonly string[] }>
export type PixelRect = Readonly<{ x: number; y: number; width: number; height: number; color: number }>

const DURATION_MS = 4_400
const ISSUE = 'Some recorded inventions could not be shown because their inventor has no visible place in the map.'

export function inventionFor(event: ReplayEvent): Invention | null {
  const actor = typeof event.actor === 'string' ? event.actor.trim() : ''
  const name = typeof event.detail.name === 'string' ? event.detail.name.trim() : ''
  const subject = event.kind === 'trait_coined' ? 'trait'
    : event.kind === 'kind_invented' || event.kind === 'kind_revised' ? 'kind' : null
  const id = subject === 'trait' ? event.detail.trait_id : subject === 'kind' ? event.detail.kind_id : null
  if (!subject || !actor || !name || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null
  return Object.freeze({ changeId: event.change_id, actor, name, subject, subjectId: id })
}

export function inventionDuration(): number {
  return DURATION_MS
}

export function stepInventions(
  state: InventionState,
  started: readonly StartedInvention[],
  residents: Simulation,
  hiddenPlaces: ReadonlySet<number>,
  now: number,
): InventionState {
  const moments = state.moments.filter(moment => now < moment.expiresAt)
  const issues = [...state.issues]
  for (const item of started) {
    const { invention, residentId: id } = item
    const resident = residents.residents[id]
    const drawable = resident && resident.placeId !== null && resident.visible && !hiddenPlaces.has(resident.placeId)
    if (!drawable) {
      if (!issues.includes(ISSUE)) issues.push(ISSUE)
      continue
    }
    moments.push(Object.freeze({ changeId: invention.changeId, residentId: resident.id, name: invention.name,
      subject: invention.subject, expiresAt: item.expiresAt }))
  }
  return Object.freeze({ moments: Object.freeze(moments), pending: moments.length > 0, issues: Object.freeze(issues) })
}

export function bulbCells(): readonly PixelRect[] {
  const cells: PixelRect[] = [
    { x: 3, y: 0, width: 3, height: 1, color: 0xffef83 },
    { x: 1, y: 1, width: 7, height: 1, color: 0xffef83 },
    { x: 0, y: 2, width: 9, height: 4, color: 0xffd34e },
    { x: 1, y: 6, width: 7, height: 1, color: 0xffef83 },
    { x: 3, y: 7, width: 3, height: 1, color: 0xffef83 },
    { x: 3, y: 8, width: 3, height: 1, color: 0x805d32 },
    { x: 2, y: 9, width: 5, height: 1, color: 0x805d32 },
    { x: 3, y: 10, width: 3, height: 1, color: 0x543c24 },
  ]
  return Object.freeze(cells.map(cell => Object.freeze(cell)))
}
