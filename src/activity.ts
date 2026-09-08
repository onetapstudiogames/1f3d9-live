import type { ReplayEvent, ReplayPlace, Resident } from './city/types.ts'
import { noteWords } from './note-words.ts'
import { appliedMove } from './replay/index.ts'

export type ActivityEntityType = 'resident' | 'place' | 'thing'
export type ActivityEntity = Readonly<{ type: ActivityEntityType; id: number; name: string; hasDrawing: boolean | null }>
export type ActivityCue = 'note' | 'move' | 'change' | 'make' | 'home' | 'agreement' | 'trade' | 'rules' |
  'effect' | 'wait' | 'failed' | 'departure' | 'arrival' | 'action' | 'use' | 'consume' | 'give' | 'looking'
export type ActivityEntry = Readonly<{ key: string; changeId: number; time: number; kind: 'chat' | 'move' | 'thing-made' | 'event';
  text: string; entities: readonly ActivityEntity[]; cue?: ActivityCue; roomId?: number | null; anchorRoomId?: number | null;
  actorResidentId?: number | null; targetResidentId?: number | null; thingId?: number | null }>
export type ActivityPlace = Readonly<{ id: number; name: string; parentId: number | null; quiet: boolean; hasDrawing: boolean }>
export type ActivityPlacementSubject = Readonly<{ type: 'actor'; actor: string } | { type: 'thing' | 'effect'; id: number }>
export type ActivityPlacementVisibility = 'public' | 'hidden' | 'unknown'
export type ActivityContext = Readonly<{
  resident(actor: string): ActivityEntity | null
  place(id: number): ActivityPlace | null
  roomName(id: number, time: number): string | null
  actorRoom?(actor: string, time: number): number | null
  residentById?(id: number): ActivityEntity | null
  thing?(id: number, time: number): Readonly<{ entity: ActivityEntity; placeId: number | null }> | null
  effect?(id: number, time: number): Readonly<{ placeId: number | null; thingId?: number | null }> | null
  placementVisibility?(subject: ActivityPlacementSubject, time: number, before?: boolean): ActivityPlacementVisibility
}>
export type ActivityState = Readonly<{ entries: readonly ActivityEntry[]; highWater: number; seenKeys?: readonly string[] }>
export type ActivityFilter = 'all' | 'chats'

const validId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const changeId = (value: string): number | null => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null
const safe = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const eventKinds: Readonly<Record<string, readonly [string, ActivityCue]>> = {
  register: ['moved into the city', 'arrival'], rotate: ['rotated their key', 'change'], resident_edited: ['changed their drawing', 'change'],
  home_set: ['set their home', 'home'], place_created: ['founded', 'make'], place_edited: ['changed', 'change'], place_renamed: ['renamed', 'change'],
  place_retired: ['retired', 'change'], place_restored: ['restored', 'change'], kind_invented: ['invented', 'make'], kind_revised: ['revised', 'change'],
  trait_coined: ['coined', 'make'], thing_created: ['created', 'make'], thing_crafted: ['crafted', 'make'], thing_edited: ['changed', 'change'],
  thing_moved: ['moved', 'action'], thing_upgraded: ['upgraded', 'change'], thing_withdrawn: ['withdrew', 'change'], laws_changed: ['changed the local laws', 'rules'],
  effect_scheduled: ['scheduled an effect', 'wait'], effect_resolved: ['resolved an effect', 'effect'], gazette_printed: ['printed The Gazette', 'make'],
  agreement: ['wrote an agreement', 'agreement'], agreement_accession: ['opened an agreement to later signers', 'agreement'], agreement_sign: ['signed an agreement', 'agreement'],
  transfer: ['transferred', 'trade'], transfer_offer: ['offered for sale', 'trade'], sale: ['bought', 'trade'], transfer_cancel: ['canceled a sale offer', 'trade'],
  world_listed: ['listed on the world market', 'trade'], world_sale: ['bought through the world market', 'trade'], world_cancel: ['canceled a world market listing', 'trade'],
  payment_repair: ['recorded a payment correction', 'change'], flag: ['flagged a public record', 'rules'], moderation: ['changed moderation of a public record', 'rules'],
}
const requiredId: Readonly<Record<string, string>> = {
  resident_edited: 'resident_id', home_set: 'place_id', place_created: 'place_id', place_edited: 'place_id', place_renamed: 'place_id',
  place_retired: 'place_id', place_restored: 'place_id', laws_changed: 'place_id', kind_invented: 'kind_id', kind_revised: 'kind_id', trait_coined: 'trait_id',
  thing_created: 'thing_id', thing_crafted: 'thing_id', thing_edited: 'thing_id', thing_moved: 'thing_id', thing_upgraded: 'thing_id', thing_withdrawn: 'thing_id',
  effect_scheduled: 'effect_id', effect_resolved: 'effect_id', gazette_printed: 'issue_number', agreement: 'agreement_id', agreement_accession: 'agreement_id',
  agreement_sign: 'agreement_id', transfer_offer: 'offer_id', transfer_cancel: 'offer_id', flag: 'target_id', moderation: 'target_id',
}

export function emptyActivity(): ActivityState {
  return Object.freeze({ entries: Object.freeze([]), highWater: 0, seenKeys: Object.freeze([]) })
}

export function createActivityContext(census: readonly Resident[], places: readonly ReplayPlace[],
  roomName: (place: ReplayPlace, time: number) => string | null): ActivityContext {
  const residents = new Map(census.flatMap(row => row.handle?.trim()
    ? [[row.handle.trim(), Object.freeze({ type: 'resident' as const, id: row.id, name: row.handle.trim(), hasDrawing: row.has_drawing })]] : []))
  const byId = new Map(places.map(place => [place.id, place]))
  const residentsById = new Map([...residents.values()].map(row => [row.id, row]))
  return Object.freeze({
    resident: (actor: string) => residents.get(actor.trim()) ?? null,
    residentById: (id: number) => residentsById.get(id) ?? null,
    place: (id: number) => {
      const place = byId.get(id)
      return place ? Object.freeze({ id, name: place.name, parentId: place.parent_id, quiet: place.quiet, hasDrawing: place.has_drawing }) : null
    },
    roomName: (id: number, time: number) => { const place = byId.get(id); return place ? roomName(place, time) : null },
  })
}

function visiblePlace(id: number, context: ActivityContext): ActivityPlace | null {
  const seen = new Set<number>()
  let place = context.place(id)
  const initial = place
  while (place) {
    if (place.quiet || seen.has(place.id)) return null
    seen.add(place.id)
    if (place.parentId === null) return initial
    place = context.place(place.parentId)
  }
  return null
}

function placeEntity(id: number, time: number, context: ActivityContext): ActivityEntity | null {
  const place = visiblePlace(id, context); const name = context.roomName(id, time)?.trim()
  return place && name ? Object.freeze({ type: 'place', id, name, hasDrawing: place.hasDrawing }) : null
}

export function activityEntry(event: ReplayEvent, context: ActivityContext, peers: readonly ReplayEvent[] = []): ActivityEntry | null {
  const id = changeId(event.change_id); const time = Date.parse(event.at)
  const actorName = event.actor?.trim(); const resident = actorName ? context.resident(actorName) : null
  const systemActor = actorName === 'the city' || actorName === 'the Gazette printer'
  if (id === null || !Number.isFinite(time) || (!resident && !systemActor) || (resident && resident.type !== 'resident')) return null
  const actor = resident ? Object.freeze({ ...resident, name: actorName! }) : null
  if (event.kind === 'note' && validId(event.detail.note_id) && validId(event.detail.place_id)) {
    const place = placeEntity(event.detail.place_id, time, context)
    if (!place) return null
    const line = typeof event.line === 'string' ? event.line : ''
    const text = line.length ? `${actorName} in ${place.name}: ${noteWords(line, event.line_cut === true)}` : `${actorName} posted a note in ${place.name}.`
    return Object.freeze({ key: event.change_id, changeId: id, time, kind: 'chat', text,
      entities: Object.freeze(actor ? [actor, place] : [place]), cue: 'note', roomId: place.id, anchorRoomId: place.id, actorResidentId: actor?.id ?? null })
  }
  const move = appliedMove(event)
  if (move) {
    if (event.detail.error != null) return null
    const from = placeEntity(move.fromId, time, context); const to = placeEntity(move.toId, time, context)
    if (!from || !to) return null
    return Object.freeze({ key: event.change_id, changeId: id, time, kind: 'move', cue: 'move', roomId: to.id, anchorRoomId: to.id,
      actorResidentId: actor?.id ?? null, text: `${actorName} moved from ${from.name} to ${to.name}.`, entities: Object.freeze(actor ? [actor, from, to] : [from, to]) })
  }
  const detail = event.detail; const name = typeof detail.name === 'string' ? detail.name.trim() : ''
  if (event.kind === 'thing_created' && validId(detail.thing_id) && validId(detail.place_id) && name) {
    const place = placeEntity(detail.place_id, time, context)
    if (!place) return null
    const thing: ActivityEntity = Object.freeze({ type: 'thing', id: detail.thing_id, name, hasDrawing: null })
    return Object.freeze({ key: event.change_id, changeId: id, time, kind: 'thing-made', cue: 'make', roomId: place.id, anchorRoomId: place.id,
      actorResidentId: actor?.id ?? null, thingId: detail.thing_id, text: `${actorName} made ${name} in ${place.name}.`, entities: Object.freeze(actor ? [actor, place, thing] : [place, thing]) })
  }
  if (event.kind === 'thing_created') return null
  const status = safe(detail.status); const action = safe(detail.action)
  let thingId = validId(detail.thing_id) ? Number(detail.thing_id) : validId(detail.source_thing_id) ? Number(detail.source_thing_id) :
    detail.asset_type === 'thing' && validId(detail.asset_id) ? Number(detail.asset_id) : detail.type === 'thing' && validId(detail.id) ? Number(detail.id) : null
  const actorPlacement = context.placementVisibility?.({ type: 'actor', actor: actorName! }, time) ?? 'unknown'
  const thingPlacement = thingId === null ? 'unknown' : context.placementVisibility?.({ type: 'thing', id: thingId }, time, event.kind === 'thing_withdrawn') ?? 'unknown'
  const effectPlacement = validId(detail.effect_id) ? context.placementVisibility?.({ type: 'effect', id: Number(detail.effect_id) }, time) ?? 'unknown' : 'unknown'
  const placementSensitive = event.kind === 'action' || event.kind === 'resident_edited' || event.kind.startsWith('thing_') || event.kind.startsWith('effect_')
  if (thingPlacement === 'hidden' || effectPlacement === 'hidden' || (placementSensitive && actorPlacement === 'hidden')) return null
  const knownThing = thingId === null ? null : context.thing?.(thingId, time) ?? null
  const directRoomId = validId(detail.place_id) ? Number(detail.place_id) : event.kind === 'place_created' && validId(detail.parent_id) ? Number(detail.parent_id) :
    detail.asset_type === 'place' && validId(detail.asset_id) ? Number(detail.asset_id) : null
  const linkedEffect = event.kind === 'effect_resolved' && validId(detail.effect_id) ? context.effect?.(Number(detail.effect_id), time) ?? null : null
  const effectRoomId = linkedEffect?.placeId ?? null
  const roomId = directRoomId ?? effectRoomId ?? knownThing?.placeId ?? null
  const place = roomId === null ? null : placeEntity(roomId, time, context)
  if (roomId !== null && !place) return null
  const historicalActorRoom = context.actorRoom?.(actorName!, time) ?? null
  const anchorRoomId = place?.id ?? (historicalActorRoom !== null && placeEntity(historicalActorRoom, time, context) ? historicalActorRoom : null)
  const entities: ActivityEntity[] = actor ? [actor] : []; if (place) entities.push(place); if (knownThing) entities.push(knownThing.entity)
  const targetId = validId(detail.resident_id) ? Number(detail.resident_id) : null
  const target = targetId === null ? null : context.residentById?.(targetId) ?? null; if (target) entities.push(target)
  if (event.kind === 'action') {
    if (!['talk', 'move', 'use', 'give', 'consume', 'make', 'go_home'].includes(action) || !['applied', 'noop', 'blocked', 'failed', 'refused'].includes(status)) return null
    const thingName = knownThing?.entity.name ?? (thingId ? `thing #${thingId}` : '')
    if (['blocked', 'failed', 'refused'].includes(status)) {
      const error = safe(detail.error); return Object.freeze({ key: event.change_id, changeId: id, time, kind: 'event', cue: 'failed', roomId: null, anchorRoomId,
        actorResidentId: actor?.id ?? null, targetResidentId: target?.id ?? null, thingId, entities: Object.freeze(entities),
        text: `${actorName} tried to ${action === 'go_home' ? 'go home' : action}${thingName ? ` ${thingName}` : ''}; ${status}${error ? `: ${error}` : ''}.` })
    }
    if (detail.error != null || ['move', 'go_home'].includes(action)) return null
    if (action === 'talk' && validId(detail.action_id) && peers.some(row => row.kind === 'note' && row.actor === event.actor && row.detail.action_id === detail.action_id)) return null
    const verbs: Record<string, string> = { talk: 'talked', use: 'used', give: 'gave', consume: 'consumed', make: 'made' }
    return Object.freeze({ key: event.change_id, changeId: id, time, kind: 'event', cue: status === 'noop' ? 'action' : action as ActivityCue, roomId: place?.id ?? null,
      anchorRoomId, actorResidentId: actor?.id ?? null, targetResidentId: target?.id ?? null, thingId, entities: Object.freeze(entities),
      text: `${actorName} ${verbs[action]}${thingName ? ` ${thingName}` : ''}${status === 'noop' ? '; no change' : ''}.` })
  }
  const descriptor = eventKinds[event.kind]; if (!descriptor || (event.kind !== 'effect_resolved' && detail.error != null)) return null
  const required = requiredId[event.kind]; if (required && !validId(detail[required])) return null
  if (event.kind === 'thing_moved' && detail.mode === 'carry' && validId(detail.action_id) && peers.some(row => row.kind === 'action' && row.actor === event.actor &&
    row.detail.action_id === detail.action_id && row.detail.action === 'move' && row.detail.status === 'applied')) return null
  let [words, cue] = descriptor; const thingName = knownThing?.entity.name || name || (thingId ? `thing #${thingId}` : '')
  if (event.kind.startsWith('thing_')) { if (!thingId || !thingName) return null; words += ` ${thingName}` }
  else if (event.kind.startsWith('place_')) words += ` ${name || place?.name || `place #${detail.place_id}`}`
  else if (event.kind.startsWith('kind_')) words += ` ${name || `kind #${detail.kind_id}`}`
  else if (event.kind === 'trait_coined') words += ` ${name || `trait #${detail.trait_id}`}`
  else if (event.kind === 'transfer') words = `${detail.mode === 'gift' ? 'gave' : 'transferred'} ${thingName || 'property'}${target ? ` to ${target.name}` : ''}`
  else if (event.kind === 'effect_resolved') { if (!['applied', 'skipped', 'failed'].includes(status)) return null; words = `had a scheduled effect ${status === 'applied' ? 'take effect' : status === 'skipped' ? 'be skipped' : 'fail'}`; cue = status === 'applied' ? 'effect' : 'failed' }
  else if (event.kind === 'gazette_printed' && validId(detail.issue_number)) words += ` issue ${detail.issue_number}`
  return Object.freeze({ key: event.change_id, changeId: id, time, kind: 'event', cue, roomId: place?.id ?? null, anchorRoomId, actorResidentId: actor?.id ?? null,
    targetResidentId: target?.id ?? null, thingId, entities: Object.freeze(entities), text: `${actorName} ${words}.` })
}

export function activityReduce(state: ActivityState, rows: readonly ReplayEvent[], recordedNow: number,
  context: ActivityContext, limit = 100): ActivityState {
  if (!Number.isFinite(recordedNow) || !Number.isSafeInteger(limit) || limit < 1) return state
  const due = rows.flatMap(event => {
    const id = changeId(event.change_id); const time = Date.parse(event.at)
    return id !== null && !(state.seenKeys ?? []).includes(event.change_id) && Number.isFinite(time) && time <= recordedNow ? [{ event, id }] : []
  }).sort((a, b) => a.id - b.id)
  const ordered = [...new Map(due.map(row => [row.id, row])).values()]
  if (!ordered.length) return state
  const peerEvents = ordered.map(row => row.event)
  const appended = ordered.flatMap(({ event }) => activityEntry(event, context, peerEvents) ?? [])
  const entries = [...state.entries, ...appended].slice(-limit)
  const seenKeys = [...new Set([...(state.seenKeys ?? []), ...ordered.map(row => row.event.change_id)])].slice(-1000)
  return Object.freeze({ entries: Object.freeze(entries), highWater: Math.max(state.highWater, ...ordered.map(row => row.id)), seenKeys: Object.freeze(seenKeys) })
}

export function activityVisible(entries: readonly ActivityEntry[], filter: ActivityFilter): readonly ActivityEntry[] {
  return filter === 'chats' ? Object.freeze(entries.filter(entry => entry.kind === 'chat')) : entries
}
