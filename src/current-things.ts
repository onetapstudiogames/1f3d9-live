import type { PlaceOutline } from './city/types.ts'
import type { NestedLayout } from './ground/nested.ts'
import type { StageStandingSpot } from './ground/stage-ground.ts'
import { addPresentThings, type ThingReservations, type ThingSimulation, type ThingState } from './things.ts'
import { roomIsPublic } from './room-view.ts'

/** Reconciles one current room outline without consulting recorded thing history. */
export function refreshPresentThings(
  state: ThingSimulation,
  outline: PlaceOutline,
  layout: NestedLayout,
  blockers: readonly StageStandingSpot[],
): ThingSimulation {
  if (outline.quiet || !roomIsPublic(layout, outline.placeId)) return state
  const listed = new Map(outline.things.map(thing => [thing.id, thing]))
  const things: Record<number, ThingState> = { ...state.things }
  const removed = new Set<number>()

  if (!outline.hasMore) {
    for (const thing of Object.values(things)) {
      if (thing.placeId === outline.placeId && !listed.has(thing.id)) {
        delete things[thing.id]
        removed.add(thing.id)
      }
    }
  }
  for (const item of outline.things) {
    const existing = things[item.id]
    if (!existing) continue
    if (existing.placeId !== outline.placeId) {
      delete things[item.id]
      removed.add(item.id)
    } else if (existing.name !== item.name) {
      things[item.id] = Object.freeze({ ...existing, name: item.name })
    }
  }

  const reservations = removeThingReservations(state.reservations, removed)
  const pending = state.queue.length > 0 || Object.values(things).some(thing => thing.effect !== null)
  const cleaned: ThingSimulation = Object.freeze({ ...state, things: Object.freeze(things), reservations, pending })
  if (outline.things.every(thing => cleaned.things[thing.id])) return cleaned
  const currentOutline: PlaceOutline = Object.freeze({ ...outline,
    things: Object.freeze(outline.things.map(thing => Object.freeze({ ...thing, placeId: outline.placeId }))),
  })
  return addPresentThings(cleaned, currentOutline, layout, blockers)
}

function removeThingReservations(reservations: ThingReservations, ids: ReadonlySet<number>): ThingReservations {
  if (!ids.size) return reservations
  return Object.freeze(Object.fromEntries(Object.entries(reservations).map(([placeId, spots]) => [placeId,
    Object.freeze(spots.filter(spot => {
      const match = /^thing:(\d+)$/.exec(spot.key)
      return !match || !ids.has(Number(match[1]))
    })),
  ])))
}
