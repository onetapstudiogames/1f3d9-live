export const OPTIONAL_OUTLINE_ISSUE = 'This room outline could not be read; its floor is kept.'

export async function readOptionalOutline<T>(id: number, reader: (id: number) => Promise<T | null>): Promise<Readonly<{
  outline: T | null; issue: string | null
}>> {
  try {
    return Object.freeze({ outline: await reader(id), issue: null })
  } catch {
    return Object.freeze({ outline: null, issue: OPTIONAL_OUTLINE_ISSUE })
  }
}

/** Commit transient issues only alongside a complete successful read cycle. */
export function readIssuesAfterCycle(previous: readonly string[], cycle: readonly string[], succeeded: boolean): readonly string[] {
  return succeeded ? Object.freeze([...new Set(cycle)]) : previous
}
