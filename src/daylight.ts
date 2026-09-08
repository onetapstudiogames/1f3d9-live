import type { Room } from './ground/nested.ts'
import { roomOutline } from './ground/room-shape.ts'

export type Daylight = Readonly<{ color: number; alpha: number }>
export type WindowRectangle = Readonly<{ x: number; y: number; width: number; height: number }>

const NEUTRAL: Daylight = Object.freeze({ color: 0xffffff, alpha: 0 })
const DAY_STOPS = Object.freeze([
  Object.freeze({ hour: 0, color: 0x62504b, alpha: 0.14 }),
  Object.freeze({ hour: 5, color: 0x62504b, alpha: 0.14 }),
  Object.freeze({ hour: 6, color: 0xf0ad78, alpha: 0.06 }),
  Object.freeze({ hour: 10, color: 0xffffff, alpha: 0 }),
  Object.freeze({ hour: 17, color: 0xffffff, alpha: 0 }),
  Object.freeze({ hour: 18, color: 0xf0a04a, alpha: 0.08 }),
  Object.freeze({ hour: 20, color: 0x62504b, alpha: 0.14 }),
  Object.freeze({ hour: 24, color: 0x62504b, alpha: 0.14 }),
])

const utcHour = (recordedTime: number): number | undefined => {
  if (!Number.isFinite(recordedTime)) return undefined
  const date = new Date(recordedTime)
  if (!Number.isFinite(date.getTime())) return undefined
  return date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3_600 + date.getUTCMilliseconds() / 3_600_000
}

const mixChannel = (from: number, to: number, amount: number): number => Math.round(from + (to - from) * amount)
const smoothStep = (amount: number): number => amount * amount * (3 - 2 * amount)

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
  const amount = smoothStep((hour - start.hour) / (end.hour - start.hour))
  return Object.freeze({
    color: mixColor(start.color, end.color, amount),
    alpha: start.alpha + (end.alpha - start.alpha) * amount,
  })
}

export function windowsLit(recordedTime: number): boolean {
  const hour = utcHour(recordedTime)
  return hour !== undefined && (hour >= 20 || hour < 6)
}

type Candidate = Readonly<{ center: Point; from: Point; to: Point; rectangle: WindowRectangle }>
type Point = Readonly<{ x: number; y: number }>

const candidate = (from: Point, to: Point, fraction: number): Candidate => {
  const horizontal = from.y === to.y
  const along = Math.round((horizontal ? from.x : from.y) + (horizontal ? to.x - from.x : to.y - from.y) * fraction)
  const direction = horizontal ? Math.sign(to.x - from.x) : Math.sign(to.y - from.y)
  const inward = horizontal ? { x: 0, y: direction * 5 } : { x: -direction * 5, y: 0 }
  const center = horizontal ? { x: along, y: from.y } : { x: from.x, y: along }
  const width = horizontal ? 12 : 6
  const height = horizontal ? 6 : 12
  return Object.freeze({ center: Object.freeze(center), from, to, rectangle: Object.freeze({
    x: center.x + inward.x - width / 2, y: center.y + inward.y - height / 2, width, height,
  }) })
}

const score = (roomId: number, index: number): number => {
  let value = (roomId ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0
  return (value ^ (value >>> 15)) >>> 0
}

const clearsDoor = (room: Room, item: Candidate): boolean => {
  const horizontal = item.from.y === item.to.y
  const doorOnWall = horizontal ? room.door.y === item.from.y && room.door.x >= Math.min(item.from.x, item.to.x)
    && room.door.x <= Math.max(item.from.x, item.to.x) : room.door.x === item.from.x
    && room.door.y >= Math.min(item.from.y, item.to.y) && room.door.y <= Math.max(item.from.y, item.to.y)
  if (!doorOnWall) return true
  return Math.hypot(item.center.x - room.door.x, item.center.y - room.door.y) >= 34
}

export function roomWindows(room: Room): readonly WindowRectangle[] {
  const fractions = [0.14, 0.3, 0.5, 0.7, 0.86]
  const candidates = roomOutline(room)
    .flatMap(([from, to]) => fractions.map(fraction => candidate(from, to, fraction)))
    .filter(item => {
      const length = Math.hypot(item.to.x - item.from.x, item.to.y - item.from.y)
      const offset = Math.hypot(item.center.x - item.from.x, item.center.y - item.from.y)
      return offset >= 24 && length - offset >= 24 && clearsDoor(room, item)
    })
    .map((item, index) => Object.freeze({ item, rank: score(room.id, index) }))
    .sort((left, right) => left.rank - right.rank)
  const count = 1 + (Math.abs(room.id) % 3)
  return Object.freeze(candidates.slice(0, count).map(entry => entry.item.rectangle))
}
