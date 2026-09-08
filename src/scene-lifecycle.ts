export type OnceEmitter = Readonly<{
  once(event: string | symbol, listener: () => void): unknown
  off(event: string | symbol, listener: () => void): unknown
}>

export function removableOnce(events: OnceEmitter, event: string | symbol, callback: () => void): () => void {
  let active = true
  const listener = (): void => {
    if (!active) return
    active = false
    callback()
  }
  events.once(event, listener)
  return () => {
    if (!active) return
    active = false
    events.off(event, listener)
  }
}
