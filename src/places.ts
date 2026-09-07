import type { ReplayEvent, ReplayFile, ReplayPlace } from './city/types.ts'
import type { NestedLayout } from './ground/nested.ts'

export type NameSpan = Readonly<{ name: string; startedAt: number; endedAt: number | null }>
export type Founding = Readonly<{
  placeId: number
  parentId: number
  name: string
  actor: string
  time: number
  changeId: string
  frontier: boolean
}>
export type Renaming = Readonly<{
  placeId: number
  name: string
  formerName: string | null
  time: number
  changeId: string
}>
export type PlacePlan = Readonly<{
  foundings: ReadonlyMap<number, Founding>
  renamings: ReadonlyMap<number, readonly Renaming[]>
  historyPlaceIds: readonly number[]
  issues: readonly string[]
  names: ReadonlyMap<number, readonly NameSpan[]>
  guardedPlaceIds: ReadonlySet<number>
  unresolvedFoundings: ReadonlySet<number>
}>

const positiveId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const timeOf = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.length === 0) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

export function parseNameHistory(value: unknown): readonly NameSpan[] | null {
  if (!Array.isArray(value)) return null
  const result: NameSpan[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null
    const row = entry as Record<string, unknown>
    const startedAt = timeOf(row.started_at)
    const endedAt = row.ended_at === null ? null : timeOf(row.ended_at)
    if (!text(row.name) || startedAt === null || (row.ended_at !== null && endedAt === null)) return null
    if (endedAt !== null && endedAt <= startedAt) return null
    const previous = result.at(-1)
    if (previous && (previous.endedAt === null || startedAt < previous.endedAt)) return null
    result.push(Object.freeze({ name: row.name, startedAt, endedAt }))
  }
  return Object.freeze(result)
}

export function nameAtTime(history: readonly NameSpan[], time: number): string | null {
  if (!Number.isFinite(time)) return null
  const span = history.find(item => item.startedAt <= time && (item.endedAt === null || time < item.endedAt))
  return span?.name ?? null
}

export function parseFounding(event: ReplayEvent): Founding | null {
  if (event.kind !== 'place_created') return null
  const time = timeOf(event.at)
  if (typeof event.detail !== 'object' || event.detail === null) return null
  const { place_id: placeId, parent_id: parentId, name, frontier } = event.detail
  if (!positiveId(placeId) || !positiveId(parentId) || !text(name) || !text(event.actor) || time === null || !text(event.change_id)) return null
  if (frontier !== undefined && frontier !== true) return null
  return Object.freeze({ placeId, parentId, name, actor: event.actor, time, changeId: event.change_id, frontier: frontier === true })
}

export function parseRenaming(event: ReplayEvent): Renaming | null {
  if (event.kind !== 'place_renamed') return null
  const time = timeOf(event.at)
  if (typeof event.detail !== 'object' || event.detail === null) return null
  const { place_id: placeId, name, former_name: formerName } = event.detail
  if (!positiveId(placeId) || !text(name) || time === null || !text(event.change_id)) return null
  if (formerName !== undefined && !text(formerName)) return null
  return Object.freeze({ placeId, name, formerName: formerName ?? null, time, changeId: event.change_id })
}

const sameFounding = (left: Founding, right: Founding): boolean =>
  left.placeId === right.placeId && left.parentId === right.parentId && left.name === right.name && left.actor === right.actor &&
  left.time === right.time && left.changeId === right.changeId && left.frontier === right.frontier
const sameRenaming = (left: Renaming, right: Renaming): boolean =>
  left.placeId === right.placeId && left.name === right.name && left.formerName === right.formerName && left.time === right.time && left.changeId === right.changeId

export function planPlaces(
  replay: ReplayFile,
  histories: ReadonlyMap<number, readonly NameSpan[]> = new Map(),
): PlacePlan {
  const start = timeOf(replay.window_start)
  const end = timeOf(replay.window_end)
  const byId = new Map(replay.map.places.map(place => [place.id, place]))
  const foundings = new Map<number, Founding>()
  const renamings = new Map<number, Renaming[]>()
  const guarded = new Set<number>()
  const invalidFoundings = new Set<number>()
  const invalidRenamings = new Set<number>()
  const issues: string[] = []
  const seen = new Map<string, Founding | Renaming>()
  const rootId = replay.map.places.find(place => place.parent_id === null)?.id

  for (const event of replay.timeline) {
    if (event.kind !== 'place_created' && event.kind !== 'place_renamed') continue
    const detail = typeof event.detail === 'object' && event.detail !== null ? event.detail : {}
    const rawPlaceId = detail.place_id
    const parsed = event.kind === 'place_created' ? parseFounding(event) : parseRenaming(event)
    if (!parsed) {
      if (positiveId(rawPlaceId)) {
        guarded.add(rawPlaceId)
        if (event.kind === 'place_created') invalidFoundings.add(rawPlaceId)
      }
      issues.push(`A recorded ${event.kind === 'place_created' ? 'founding' : 'renaming'} could not be shown because its notice is incomplete.`)
      continue
    }
    if (start === null || end === null || parsed.time < start || parsed.time > end) continue
    guarded.add(parsed.placeId)
    const old = seen.get(parsed.changeId)
    if (old) {
      const same = 'parentId' in parsed && 'parentId' in old ? sameFounding(parsed, old) : !('parentId' in parsed) && !('parentId' in old) && sameRenaming(parsed, old)
      if (same) continue
      invalidRenamings.add(parsed.placeId)
      invalidRenamings.add(old.placeId)
      if ('parentId' in parsed) invalidFoundings.add(parsed.placeId)
      if ('parentId' in old) invalidFoundings.add(old.placeId)
      issues.push(`Place notice ${parsed.changeId} contradicts another notice, so it was not shown.`)
      continue
    }
    seen.set(parsed.changeId, parsed)
    const place = byId.get(parsed.placeId)
    if (!place) {
      issues.push(`Place ${String(parsed.placeId)} is not in the recorded map, so its ${'parentId' in parsed ? 'founding' : 'renaming'} was not shown.`)
      continue
    }
    if ('parentId' in parsed) {
      if (parsed.frontier && parsed.parentId !== rootId) {
        invalidFoundings.add(parsed.placeId)
        issues.push(`Place ${String(parsed.placeId)} has a frontier notice away from the world edge, so its founding was not shown.`)
        continue
      }
      if (place.parent_id !== parsed.parentId) {
        invalidFoundings.add(parsed.placeId)
        issues.push(`Place ${String(parsed.placeId)} has a different recorded parent, so its founding was not shown.`)
        continue
      }
      const existing = foundings.get(parsed.placeId)
      if (existing && !sameFounding(existing, parsed)) {
        invalidFoundings.add(parsed.placeId)
        issues.push(`Place ${String(parsed.placeId)} has contradictory founding notices, so its founding was not shown.`)
      } else foundings.set(parsed.placeId, parsed)
    } else {
      const list = renamings.get(parsed.placeId) ?? []
      renamings.set(parsed.placeId, [...list, parsed])
    }
  }

  for (const id of invalidFoundings) foundings.delete(id)
  for (const [id, rows] of renamings) {
    rows.sort((left, right) => left.time - right.time || left.changeId.localeCompare(right.changeId))
    const founding = foundings.get(id)
    let prior = founding?.name ?? rows[0]?.formerName ?? null
    for (const [index, row] of rows.entries()) {
      if (founding && row.time < founding.time) invalidRenamings.add(id)
      if ((index > 0 || founding) && row.formerName !== null && prior !== row.formerName) invalidRenamings.add(id)
      if (index > 0 && row.time === rows[index - 1]!.time && row.name !== rows[index - 1]!.name) invalidRenamings.add(id)
      prior = row.name
    }
    if (invalidRenamings.has(id)) {
      renamings.delete(id)
      issues.push(`Place ${String(id)} has contradictory renaming notices, so its names were not shown.`)
    } else renamings.set(id, rows)
  }

  const needed = new Set<number>()
  for (const [id, rows] of renamings) {
    if (foundings.has(id) || rows[0]?.formerName !== null) continue
    const history = histories.get(id)
    if (!history) {
      needed.add(id)
      issues.push(`The earlier name of place ${String(id)} could not be read, so it stays blank.`)
    }
    else {
      const firstTime = rows[0]!.time
      if (!history.some(span => span.endedAt === firstTime && span.startedAt < firstTime)) {
        issues.push(`The earlier name of place ${String(id)} is not in its recorded history.`)
      }
    }
  }
  return Object.freeze({
    foundings, renamings, historyPlaceIds: Object.freeze([...needed].sort((a, b) => a - b)), issues: Object.freeze(issues),
    names: histories, guardedPlaceIds: guarded,
    unresolvedFoundings: invalidFoundings,
  })
}

export function recordedRoomName(plan: PlacePlan, place: Pick<ReplayPlace, 'id' | 'name'>, time: number): string | null {
  if (!Number.isFinite(time)) return null
  const founding = plan.foundings.get(place.id)
  if (founding && time < founding.time) return null
  const rows = plan.renamings.get(place.id)
  if (!rows?.length) return plan.guardedPlaceIds.has(place.id) ? (founding?.name ?? null) : place.name
  let name = founding?.name ?? rows[0]!.formerName
  if (name === null) {
    const firstTime = rows[0]!.time
    const predecessor = (plan.names.get(place.id) ?? []).find(span => span.endedAt === firstTime)
    name = predecessor && predecessor.startedAt <= time && time < firstTime ? predecessor.name : null
  }
  for (const row of rows) {
    if (time < row.time) break
    name = row.name
  }
  return name
}

export function hiddenRooms(plan: PlacePlan, layout: NestedLayout, time: number): ReadonlySet<number> {
  const hidden = new Set<number>()
  const hide = (id: number): void => {
    if (hidden.has(id)) return
    hidden.add(id)
    for (const child of layout.rooms[id]?.children ?? []) hide(child)
  }
  for (const id of plan.unresolvedFoundings) if (layout.rooms[id]) hide(id)
  for (const founding of plan.foundings.values()) if (time < founding.time && layout.rooms[founding.placeId]) hide(founding.placeId)
  return hidden
}
