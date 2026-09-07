import type Phaser from 'phaser'
import { soundRecipe, type SoundCue } from '../sound.ts'

type AudioManager = Readonly<{ context: AudioContext; destination: AudioNode }>

export class SoundView {
  private readonly scene: Phaser.Scene
  private active = new Set<{ oscillator: OscillatorNode; gain: GainNode }>()
  constructor(scene: Phaser.Scene) { this.scene = scene }

  async unlock(): Promise<void> {
    const context = (this.scene.sound as unknown as Partial<AudioManager>).context
    if (context?.state === 'suspended') try { await context.resume() } catch { /* sound remains unavailable */ }
  }

  play(cues: readonly SoundCue[]): boolean {
    const manager = this.scene.sound as unknown as Partial<AudioManager>
    if (!manager.context || !manager.destination || manager.context.state !== 'running') return false
    try {
      for (const cue of cues) for (const tone of soundRecipe(cue.kind)) {
        if (this.active.size >= 8) break
        const oscillator = manager.context.createOscillator()
        const gain = manager.context.createGain()
        const voice = { oscillator, gain }
        oscillator.type = tone.wave
        oscillator.frequency.setValueAtTime(tone.frequency, manager.context.currentTime)
        gain.gain.setValueAtTime(tone.gain, manager.context.currentTime + tone.delay)
        gain.gain.exponentialRampToValueAtTime(0.0001, manager.context.currentTime + tone.delay + tone.duration)
        oscillator.connect(gain); gain.connect(manager.destination)
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.active.delete(voice) }
        this.active.add(voice)
        oscillator.start(manager.context.currentTime + tone.delay)
        oscillator.stop(manager.context.currentTime + tone.delay + tone.duration)
      }
      return true
    } catch { this.stop(); return false }
  }

  stop(): void {
    for (const voice of this.active) {
      voice.oscillator.onended = null
      try { voice.oscillator.stop() } catch { /* already stopped */ }
      voice.oscillator.disconnect(); voice.gain.disconnect()
    }
    this.active.clear()
  }
}
