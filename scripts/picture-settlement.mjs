export async function waitForStablePicture(sample, options = {}) {
  const stableMs = options.stableMs ?? 1_000
  const timeoutMs = options.timeoutMs ?? 60_000
  const intervalMs = options.intervalMs ?? 100
  const now = options.now ?? Date.now
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const startedAt = now()
  let stableSince = null
  let signature = ''
  while (now() - startedAt <= timeoutMs) {
    const state = await sample()
    const nextSignature = JSON.stringify(state.picture)
    if (state.settled && nextSignature === signature) {
      stableSince ??= now()
      if (now() - stableSince >= stableMs) return state
    } else {
      signature = nextSignature
      stableSince = state.settled ? now() : null
    }
    await wait(intervalMs)
  }
  throw new Error(`The live picture did not settle within ${timeoutMs}ms.`)
}
