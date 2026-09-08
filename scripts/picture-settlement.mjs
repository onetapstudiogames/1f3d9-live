export async function waitForStablePicture(sample, options = {}) {
  const stableMs = options.stableMs ?? 1_000
  const timeoutMs = options.timeoutMs ?? 60_000
  const intervalMs = options.intervalMs ?? 100
  const now = options.now ?? Date.now
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const schedule = options.schedule ?? ((callback, milliseconds) => setTimeout(callback, milliseconds))
  const cancel = options.cancel ?? (timer => clearTimeout(timer))
  const startedAt = now()
  const timeoutError = () => new Error(`The live picture did not settle within ${timeoutMs}ms.`)
  const boundedSample = async remainingMs => {
    let timer
    const deadline = new Promise((_, reject) => {
      timer = schedule(() => reject(timeoutError()), remainingMs)
    })
    try {
      return await Promise.race([Promise.resolve().then(sample), deadline])
    } finally {
      cancel(timer)
    }
  }
  let stableSince = null
  let signature = ''
  while (now() - startedAt <= timeoutMs) {
    const remainingMs = timeoutMs - (now() - startedAt)
    if (remainingMs <= 0) throw timeoutError()
    const state = await boundedSample(remainingMs)
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
  throw timeoutError()
}
