import assert from 'node:assert/strict'
import test from 'node:test'
import { readSoundEnabled, saveSoundEnabled, SOUND_KEY } from '../src/preferences.ts'
import { fixtureMode } from '../src/scenes/fixture-state.ts'

test('sound is off by default and survives a visit when storage works', () => {
  const values = new Map<string, string>()
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  assert.equal(readSoundEnabled(store), false)
  assert.equal(saveSoundEnabled(store, true), true)
  assert.equal(values.get(SOUND_KEY), 'true')
  assert.equal(readSoundEnabled(store), true)
})

test('fixture mode follows only saved replay or census overrides', () => {
  assert.equal(fixtureMode('?replay=/fixtures/replay.json'), true)
  assert.equal(fixtureMode('?census=/fixtures/census.json'), true)
  assert.equal(fixtureMode('?speed=300'), false)
})

test('unavailable storage leaves sound safely off', () => {
  const broken = { getItem(): string { throw new Error('blocked') }, setItem(): void { throw new Error('blocked') } }
  assert.equal(readSoundEnabled(broken), false)
  assert.equal(saveSoundEnabled(broken, true), false)
  assert.equal(saveSoundEnabled(null, true), false)
})
