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

export type ReplayStart = Readonly<{ origin_event_id: number; place_id: number }>

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
  actor: string
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
  checkpoint: number
  complete: boolean
  row_ceiling: number
  map: Readonly<{ places: readonly ReplayPlace[] }>
  start: Readonly<Record<string, ReplayStart>>
  counts: Readonly<Record<string, Readonly<{ residents: number; things: number }>>>
  timeline: readonly ReplayEvent[]
}>

export type Drawing = Readonly<{
  type: 'resident' | 'place'
  id: number
  state: string
  drawing: Readonly<{ palette: readonly string[]; indices: readonly (number | null)[] }> | null
}>
