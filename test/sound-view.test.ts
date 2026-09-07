import assert from 'node:assert/strict'
import test from 'node:test'
import { SoundView } from '../src/scenes/SoundView.ts'
import { soundRecipe } from '../src/sound.ts'

test('sound voices use the Phaser destination and stop cleanly', () => {
  const destination = {}
  let connected: unknown
  let stopped = 0
  const oscillator = { type: 'sine', frequency: { setValueAtTime() {} }, connect(node: unknown) { connected = node },
    disconnect() {}, start() {}, stop() { stopped += 1 }, onended: null as (() => void) | null }
  const gain = { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect(node: unknown) { assert.equal(node, destination) }, disconnect() {} }
  const scene = { sound: { context: { state: 'running', currentTime: 4, createOscillator: () => oscillator, createGain: () => gain }, destination } }
  const view = new SoundView(scene as never)
  assert.equal(view.play([{ kind: 'pop', key: 'note:1' }]), true)
  assert.equal(connected, gain)
  const scheduledStops = stopped
  view.stop()
  assert.equal(stopped - scheduledStops, soundRecipe('pop').length)
})

test('missing Web Audio support stays silent', () => {
  assert.equal(new SoundView({ sound: {} } as never).play([{ kind: 'step', key: 'walk:1' }]), false)
})

test('a suspended Phaser context does not queue a later burst', () => {
  let created = 0
  const context = { state: 'suspended', createOscillator() { created += 1 } }
  assert.equal(new SoundView({ sound: { context, destination: {} } } as never).play([{ kind: 'chime', key: 'place:1' }]), false)
  assert.equal(created, 0)
})
