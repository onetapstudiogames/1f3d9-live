export type SoundKind = 'step' | 'pop' | 'chime'
export type SoundCue = Readonly<{ kind: SoundKind; key: string }>
export type Tone = Readonly<{ frequency: number; duration: number; gain: number; wave: OscillatorType; delay: number }>
export type SoundResident = Readonly<{ id: number; walkKey: string | null; walkElapsed: number; bubbleKey: string | null;
  drawn: boolean; onCamera: boolean }>
export type SoundFounding = Readonly<{ key: string; endsAt: number; drawn: boolean; onCamera: boolean }>
export type SoundState = Readonly<{ bubbles: ReadonlyMap<number, string>; walkTicks: ReadonlyMap<string, number>;
  foundings: ReadonlyMap<string, SoundFounding>; lastStepAt: number }>
export type SoundInput = Readonly<{ enabled: boolean; trusted: boolean; paused: boolean; now: number;
  residents: readonly SoundResident[]; activeFoundings: readonly SoundFounding[] }>

const STEP_MS = 420
export function createSoundState(): SoundState {
  return Object.freeze({ bubbles: new Map<number, string>(), walkTicks: new Map<string, number>(), foundings: new Map<string, SoundFounding>(), lastStepAt: -Infinity })
}

export function soundFrame(previous: SoundState, input: SoundInput): Readonly<{ state: SoundState; cues: readonly SoundCue[] }> {
  const audible = input.enabled && input.trusted && !input.paused
  const bubbles = new Map(previous.bubbles); const walkTicks = new Map<string, number>(); const cues: SoundCue[] = []
  let step: SoundCue | null = null
  for (const resident of input.residents) {
    if (resident.bubbleKey && bubbles.get(resident.id) !== resident.bubbleKey) {
      bubbles.set(resident.id, resident.bubbleKey)
      if (audible && resident.drawn && resident.onCamera && !cues.some(cue => cue.kind === 'pop'))
        cues.push(Object.freeze({ kind: 'pop', key: resident.bubbleKey }))
    }
    if (!resident.walkKey) continue
    const tick = Math.max(0, Math.floor(resident.walkElapsed / STEP_MS)); walkTicks.set(resident.walkKey, tick)
    if ((previous.walkTicks.get(resident.walkKey) ?? -1) < tick && audible && resident.drawn && resident.onCamera
      && input.now - previous.lastStepAt >= STEP_MS) step ??= Object.freeze({ kind: 'step', key: `${resident.walkKey}:${tick}` })
  }
  if (step) cues.push(step)
  const foundings = new Map(input.activeFoundings.map(row => [row.key, row]))
  for (const former of previous.foundings.values()) if (!foundings.has(former.key) && input.now >= former.endsAt
    && audible && former.drawn && former.onCamera && !cues.some(cue => cue.kind === 'chime'))
    cues.push(Object.freeze({ kind: 'chime', key: former.key }))
  const state = Object.freeze({ bubbles, walkTicks, foundings,
    lastStepAt: step ? input.now : previous.lastStepAt })
  return Object.freeze({ state, cues: Object.freeze(cues) })
}

export function soundRecipe(kind: SoundKind): readonly Tone[] {
  const tones: Record<SoundKind, readonly Tone[]> = {
    step: [{ frequency: 115, duration: 0.045, gain: 0.012, wave: 'square', delay: 0 }],
    pop: [{ frequency: 330, duration: 0.07, gain: 0.018, wave: 'sine', delay: 0 }],
    chime: [{ frequency: 523, duration: 0.18, gain: 0.025, wave: 'sine', delay: 0 },
      { frequency: 659, duration: 0.2, gain: 0.02, wave: 'sine', delay: 0.08 }],
  }
  return Object.freeze(tones[kind].map(tone => Object.freeze(tone)))
}
