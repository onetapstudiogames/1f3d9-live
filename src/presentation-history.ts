export type PlaybackMode = 'pause' | 'normal' | 'fast' | 'rewind'

export type TapeOptions = Readonly<{
  sampleIntervalMs?: number
  checkpointIntervalMs?: number
}>

export type RecordOptions = Readonly<{ force?: boolean }>

export type SeekResult<T> = Readonly<{ time: number, frame: T }>
export type PlaybackPosition = Readonly<{ time: number, atHead: boolean, atStart: boolean }>

type Replace = { readonly kind: 'replace', readonly value: unknown }
type Children = { readonly kind: 'children', readonly container: 'array' | 'object', readonly changes: ReadonlyMap<PropertyKey, Patch>, readonly removed: readonly PropertyKey[] }
type Patch = Replace | Children
type Entry = Readonly<{ time: number, patch: Patch | null }>
type Block = Readonly<{ time: number, checkpoint: unknown, entries: readonly Entry[] }>
declare const FRAME_TYPE: unique symbol

export type PresentationTape<T> = Readonly<{
  readonly [FRAME_TYPE]?: T
  sampleIntervalMs: number
  checkpointIntervalMs: number
  frameCount: number
  checkpointCount: number
  startTime: number | null
  endTime: number | null
}>

const BLOCKS = Symbol('presentation tape blocks')
const HEAD = Symbol('presentation tape head')
type TapeState<T> = PresentationTape<T> & Readonly<{ [BLOCKS]: readonly Block[], [HEAD]: T | null }>
const state = <T>(tape: PresentationTape<T>): TapeState<T> => tape as TapeState<T>

const validInterval = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`)
  return value
}

export function createTape<T>(options: TapeOptions = {}): PresentationTape<T> {
  return Object.freeze({
    sampleIntervalMs: validInterval(options.sampleIntervalMs ?? 250, 'sampleIntervalMs'),
    checkpointIntervalMs: validInterval(options.checkpointIntervalMs ?? 10_000, 'checkpointIntervalMs'),
    frameCount: 0,
    checkpointCount: 0,
    startTime: null,
    endTime: null,
    [BLOCKS]: Object.freeze([]),
    [HEAD]: null,
  }) as TapeState<T>
}

const tag = (value: unknown): string => Object.prototype.toString.call(value)

function copy(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (value === null || typeof value !== 'object') return value
  const known = seen.get(value)
  if (known !== undefined) return known
  if (value instanceof Date) return new Date(value.getTime())
  if (value instanceof Map) {
    const result = new Map<unknown, unknown>(); seen.set(value, result)
    for (const [key, item] of value) result.set(copy(key, seen), copy(item, seen))
    return result
  }
  if (value instanceof Set) {
    const result = new Set<unknown>(); seen.set(value, result)
    for (const item of value) result.add(copy(item, seen))
    return result
  }
  if (Array.isArray(value)) {
    const result: unknown[] = []; seen.set(value, result)
    for (const item of value) result.push(copy(item, seen))
    return result
  }
  if (tag(value) !== '[object Object]') throw new TypeError(`Unsupported presentation value: ${tag(value)}`)
  const result: Record<PropertyKey, unknown> = {}; seen.set(value, result)
  for (const key of Reflect.ownKeys(value)) result[key] = copy((value as Record<PropertyKey, unknown>)[key], seen)
  return result
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
  if (left instanceof Map || right instanceof Map) {
    if (!(left instanceof Map && right instanceof Map) || left.size !== right.size) return false
    for (const [key, value] of left) if (!right.has(key) || !equal(value, right.get(key))) return false
    return true
  }
  if (left instanceof Set || right instanceof Set) {
    if (!(left instanceof Set && right instanceof Set) || left.size !== right.size) return false
    for (const value of left) if (!right.has(value)) return false
    return true
  }
  if (Array.isArray(left) !== Array.isArray(right) || tag(left) !== tag(right)) return false
  const leftKeys = Reflect.ownKeys(left); const rightKeys = Reflect.ownKeys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key)
    && equal((left as Record<PropertyKey, unknown>)[key], (right as Record<PropertyKey, unknown>)[key]))
}

function difference(before: unknown, after: unknown): Patch | null {
  if (equal(before, after)) return null
  const arrays = Array.isArray(before) && Array.isArray(after)
  const objects = tag(before) === '[object Object]' && tag(after) === '[object Object]'
  if (!arrays && !objects) return { kind: 'replace', value: copy(after) }
  const oldValue = before as Record<PropertyKey, unknown>
  const newValue = after as Record<PropertyKey, unknown>
  const changes = new Map<PropertyKey, Patch>()
  const removed = Reflect.ownKeys(oldValue).filter(key => !Object.prototype.hasOwnProperty.call(newValue, key))
  for (const key of Reflect.ownKeys(newValue)) {
    const child = difference(oldValue[key], newValue[key])
    if (child) changes.set(key, child)
  }
  return { kind: 'children', container: arrays ? 'array' : 'object', changes, removed }
}

function apply(value: unknown, patch: Patch): unknown {
  if (patch.kind === 'replace') return copy(patch.value)
  const result: Record<PropertyKey, unknown> = patch.container === 'array'
    ? [...(value as unknown[])] as unknown as Record<PropertyKey, unknown>
    : { ...(value as Record<PropertyKey, unknown>) }
  for (const key of patch.removed) delete result[key]
  for (const [key, child] of patch.changes) result[key] = apply(result[key], child)
  return result
}

const assertTime = (time: number): void => {
  if (!Number.isFinite(time)) throw new RangeError('time must be finite')
}

export function recordFrame<T>(tape: PresentationTape<T>, time: number, frame: T, options: RecordOptions = {}): PresentationTape<T> {
  assertTime(time)
  if (tape.endTime !== null && time < tape.endTime) throw new RangeError('record time must not regress')
  if (!options.force && tape.endTime !== null && time - tape.endTime < tape.sampleIntervalMs) return tape
  const snapshot = copy(frame) as T
  const stored = state(tape)
  const startBlock = stored[BLOCKS].length === 0
    || time - stored[BLOCKS][stored[BLOCKS].length - 1]!.time >= tape.checkpointIntervalMs
  const blocks = [...stored[BLOCKS]]
  if (startBlock) {
    blocks.push(Object.freeze({ time, checkpoint: snapshot, entries: Object.freeze([]) }))
  } else {
    const last = blocks[blocks.length - 1]!
    const patch = difference(stored[HEAD], snapshot)
    blocks[blocks.length - 1] = Object.freeze({ ...last, entries: Object.freeze([...last.entries, Object.freeze({ time, patch })]) })
  }
  return Object.freeze({
    ...tape,
    [BLOCKS]: Object.freeze(blocks),
    [HEAD]: snapshot,
    frameCount: tape.frameCount + 1,
    checkpointCount: tape.checkpointCount + (startBlock ? 1 : 0),
    startTime: tape.startTime ?? time,
    endTime: time,
  }) as TapeState<T>
}

export function seekFrame<T>(tape: PresentationTape<T>, time: number): SeekResult<T> | null {
  assertTime(time)
  if (tape.startTime === null || time < tape.startTime) return null
  let block: Block | undefined
  const blocks = state(tape)[BLOCKS]
  for (let index = blocks.length - 1; index >= 0; index--) {
    if (blocks[index]!.time <= time) { block = blocks[index]; break }
  }
  if (!block) return null
  let restored = copy(block.checkpoint)
  let restoredTime = block.time
  for (const entry of block.entries) {
    if (entry.time > time) break
    if (entry.patch) restored = apply(restored, entry.patch)
    restoredTime = entry.time
  }
  return Object.freeze({ time: restoredTime, frame: copy(restored) as T })
}

export function playbackCursor<T>(tape: PresentationTape<T>, cursor: number, deltaMs: number, mode: PlaybackMode): PlaybackPosition {
  assertTime(cursor); assertTime(deltaMs)
  if (deltaMs < 0) throw new RangeError('deltaMs must be non-negative')
  const start = tape.startTime ?? cursor
  const head = tape.endTime ?? cursor
  const speed = mode === 'rewind' ? -30 : mode === 'fast' ? 60 : mode === 'normal' ? 1 : 0
  const time = Math.min(head, Math.max(start, cursor + deltaMs * speed))
  return Object.freeze({ time, atHead: time === head, atStart: time === start })
}

export function truncateTape<T>(tape: PresentationTape<T>, time: number): PresentationTape<T> {
  assertTime(time)
  if (tape.endTime === null || time >= tape.endTime) return tape
  let result = createTape<T>(tape)
  for (const block of state(tape)[BLOCKS]) {
    if (block.time > time) break
    let restored = copy(block.checkpoint)
    result = recordFrame(result, block.time, restored as T, { force: true })
    for (const entry of block.entries) {
      if (entry.time > time) break
      if (entry.patch) restored = apply(restored, entry.patch)
      result = recordFrame(result, entry.time, restored as T, { force: true })
    }
  }
  return result
}
