import type { ReplayEvent } from './city/types.ts'
import type { ResidentState } from './replay/simulation.ts'

export type HeldActionThingEvent = Readonly<{ event: ReplayEvent; actionKey: string }>

/** Floor changes wait for their resident's witnessed turn, including a consume's withdrawal. */
export function actionFloorEvents(previous: readonly HeldActionThingEvent[], incoming: readonly ReplayEvent[],
  residents: Readonly<Record<number, ResidentState>>): Readonly<{
    held: readonly HeldActionThingEvent[]; events: readonly ReplayEvent[]
  }> {
  const pending = Object.values(residents).flatMap(resident => [
    ...(resident.actionEvent ? [resident.actionEvent] : []), ...resident.queue.map(row => row.event),
  ]).filter(actionThingEvent).sort((left, right) => Number(left.change_id) - Number(right.change_id))
  const pendingKeys = new Set(pending.map(row => row.change_id))
  const released = previous.filter(row => !pendingKeys.has(row.actionKey)).map(row => row.event)
  const retained = previous.filter(row => pendingKeys.has(row.actionKey))
  const additions = incoming.map(event => {
    const thingId = event.detail.source_thing_id ?? event.detail.thing_id
    const matches = pending.filter(row => row.detail.source_thing_id === thingId)
    const exact = matches.find(row => row.change_id === event.change_id ||
      event.detail.action_id != null && row.detail.action_id === event.detail.action_id)
    const before = matches.filter(row => Number(row.change_id) <= Number(event.change_id)).at(-1)
    const waiting = exact ?? before
    return Object.freeze({ event, actionKey: waiting?.change_id ?? null })
  })
  return Object.freeze({
    held: Object.freeze([...retained, ...additions.flatMap(row => row.actionKey === null ? [] : [{ event: row.event, actionKey: row.actionKey }])]),
    events: Object.freeze([...released, ...additions.filter(row => row.actionKey === null).map(row => row.event)]),
  })
}

export function actionThingEvent(event: ReplayEvent): boolean {
  return event.kind === 'action' && ['use', 'consume'].includes(String(event.detail.action)) &&
    (event.detail.status === 'applied' || event.detail.action === 'use' && event.detail.status === 'noop') && event.detail.error == null &&
    Number.isSafeInteger(event.detail.source_thing_id) && Number(event.detail.source_thing_id) > 0
}
