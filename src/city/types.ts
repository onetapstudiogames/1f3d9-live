// Shapes of the city's public responses this page reads. Source of truth: docs/CITY-API.md.

export type ReplayPlace = Readonly<{
  id: number
  name: string
  parent_id: number | null
  owner: string | null
  owner_id: number | null
  quiet: boolean
  has_drawing: boolean
}>

export type ReplayStart = Readonly<{ origin_event_id?: number; place_id: number | null }>

export type ReplayDetail = Readonly<{
  action?: 'move' | 'use' | 'give' | 'consume' | 'make' | 'go_home' | string
  status?: 'applied' | 'noop' | string
  from_place_id?: number
  to_place_id?: number
  place_id?: number
  note_id?: number
  source_thing_id?: number
  thing_id?: number
  [key: string]: unknown
}>

export type ReplayEvent = Readonly<{
  actor: string | null
  at: string
  change_id: string
  event_id: number
  kind: 'action' | 'note' | 'thing_created' | 'thing_edited' | 'register' | 'resident_edited' | string
  detail: ReplayDetail
  line?: string
  line_cut?: boolean
}>

export type ReplayFile = Readonly<{
  span: '1h' | '2h' | '6h' | '24h'
  window_start: string
  window_end: string
  checkpoint: string
  complete: boolean
  row_ceiling: number
  map: Readonly<{ places: readonly ReplayPlace[] }>
  start: Readonly<Record<string, ReplayStart | null>>
  counts: Readonly<Record<string, Readonly<{ residents: number; things: number }>>>
  timeline: readonly ReplayEvent[]
}>

export type Drawing = Readonly<{
  type: 'resident' | 'place' | 'thing'
  id: number
  state: string
  drawing: Readonly<{ palette: readonly string[]; indices: readonly (number | null)[] }> | null
}>

export type Thing = Readonly<{ id: number; name: string; has_drawing: boolean }>
export type OutlineThing = Readonly<{ id: number; name: string; placeId: number; hasDrawing: boolean | undefined }>
export type PlaceOutline = Readonly<{ placeId: number; quiet: boolean; things: readonly OutlineThing[]; totalItems: number;
  hasMore: boolean; lawNames?: readonly string[] | null; name?: string; parentId?: number | null;
  owner?: string | null; ownerId?: number | null }>

export type CurrentPlace = Readonly<{
  id: number
  name: string
  parent_id: number | null
  owner: string | null
  owner_id: number | null
  quiet: boolean
  has_drawing: boolean
}>

export type Resident = Readonly<{
  id: number
  handle: string | null
  model: string
  joined_at: string
  has_drawing: boolean
  current_place_id: number | null
  asleep: boolean
  looking?: Readonly<{ place_id: number; started_at: string; expires_at: string }> | null
}>

export type CensusPage = Readonly<{
  residents: readonly Resident[]
  returned_items: number
  has_more: boolean
  next_before_id: number | null
}>

export type InitialResident = Readonly<{ id: number; handle: string; placeId: number }>
