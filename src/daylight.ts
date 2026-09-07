import type { Room } from './ground/nested.ts'

export type Daylight = Readonly<{ color: number; alpha: number }>
export type WindowRectangle = Readonly<{ x: number; y: number; width: number; height: number }>

const NEUTRAL: Daylight = Object.freeze({ color: 0xffffff, alpha: 0 })
const DAY_STOPS = Object.freeze([
  Object.freeze({ hour: 0, color: 0x163b92, alpha: 0.45 }),
  Object.freeze({ hour: 5, color: 0x163b92, alpha: 0.45 }),
  Object.freeze({ hour: 6, color: 0xf0ad78, alpha: 0.12 }),
  Object.freeze({ hour: 10, color: 0xffffff, alpha: 0 }),
  Object.freeze({ hour: 17, color: 0xffffff, alpha: 0 }),
  Object.freeze({ hour: 18, color: 0xf0a04a, alpha: 0.18 }),
  Object.freeze({ hour: 20, color: 0x163b92, alpha: 0.45 }),
  Object.freeze({ hour: 24, color: 0x163b92, alpha: 0.45 }),
])

const utcHour = (recordedTime: number): number | undefined => {
  if (!Number.isFinite(recordedTime)) return undefined
  const date = new Date(recordedTime)
  if (!Number.isFinite(date.getTime())) return undefined
  return date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3_600 + date.getUTCMilliseconds() / 3_600_000
}

const mixChannel = (from: number, to: number, amount: number): number => Math.round(from + (to - from) * amount)

const mixColor = (from: number, to: number, amount: number): number => {
  const red = mixChannel((from >> 16) & 0xff, (to >> 16) & 0xff, amount)
  const green = mixChannel((from >> 8) & 0xff, (to >> 8) & 0xff, amount)
  const blue = mixChannel(from & 0xff, to & 0xff, amount)
  return (red << 16) | (green << 8) | blue
}

export function daylightAt(recordedTime: number): Daylight {
  const hour = utcHour(recordedTime)
  if (hour === undefined) return NEUTRAL
  const endIndex = DAY_STOPS.findIndex(stop => stop.hour >= hour)
  const end = DAY_STOPS[Math.max(1, endIndex)]!
  const start = DAY_STOPS[Math.max(0, endIndex - 1)]!
  const amount = (hour - start.hour) / (end.hour - start.hour)
  return Object.freeze({
    color: mixColor(start.color, end.color, amount),
    alpha: start.alpha + (end.alpha - start.alpha) * amount,
  })
}

export function windowsLit(recordedTime: number): boolean {
  const hour = utcHour(recordedTime)
  return hour !== undefined && (hour >= 20 || hour < 6)
}

type Wall = 'top' | 'right' | 'bottom' | 'left'
type Candidate = Readonly<{ wall: Wall; center: number; rectangle: WindowRectangle }>

const candidate = (room: Room, wall: Wall, fraction: number): Candidate => {
  const horizontal = wall === 'top' || wall === 'bottom'
  const center = Math.round((horizontal ? room.x : room.y) + (horizontal ? room.width : room.height) * fraction)
  const width = horizontal ? 12 : 6
  const height = horizontal ? 6 : 12
  const x = wall === 'left' ? room.x + 2 : wall === 'right' ? room.x + room.width - width - 2 : center - width / 2
  const y = wall === 'top' ? room.y + 2 : wall === 'bottom' ? room.y + room.height - height - 2 : center - height / 2
  return Object.freeze({ wall, center, rectangle: Object.freeze({ x, y, width, height }) })
}

const score = (roomId: number, index: number): number => {
  let value = (roomId ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0
  return (value ^ (value >>> 15)) >>> 0
}

const clearsDoor = (room: Room, item: Candidate): boolean => {
  const doorOnWall = item.wall === 'top' ? room.door.y === room.y
    : item.wall === 'bottom' ? room.door.y === room.y + room.height
      : item.wall === 'left' ? room.door.x === room.x
        : room.door.x === room.x + room.width
  if (!doorOnWall) return true
  const doorCenter = item.wall === 'top' || item.wall === 'bottom' ? room.door.x : room.door.y
  return Math.abs(item.center - doorCenter) >= 34
}

export function roomWindows(room: Room): readonly WindowRectangle[] {
  const fractions = [0.14, 0.3, 0.5, 0.7, 0.86]
  const candidates = (['top', 'right', 'bottom', 'left'] as const)
    .flatMap(wall => fractions.map(fraction => candidate(room, wall, fraction)))
    .filter(item => {
      const wallStart = item.wall === 'top' || item.wall === 'bottom' ? room.x : room.y
      const wallEnd = item.wall === 'top' || item.wall === 'bottom' ? room.x + room.width : room.y + room.height
      return item.center - wallStart >= 24 && wallEnd - item.center >= 24 && clearsDoor(room, item)
    })
    .map((item, index) => Object.freeze({ item, rank: score(room.id, index) }))
    .sort((left, right) => left.rank - right.rank)
  const count = 1 + (Math.abs(room.id) % 3)
  return Object.freeze(candidates.slice(0, count).map(entry => entry.item.rectangle))
}
