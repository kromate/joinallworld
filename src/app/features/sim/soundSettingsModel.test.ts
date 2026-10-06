import assert from 'node:assert/strict'
import test from 'node:test'
import { SOUND_DEFAULTS } from '../../../audio/settings.ts'
import { SOUND_SLIDERS, SOUND_SWITCHES, change, levelOf, percent, soundSummary } from './soundSettingsModel.ts'

test('levels are shown as whole percents and read back from a slider', () => {
  assert.equal(percent(0.6), 60); assert.equal(percent(0.354), 35); assert.equal(percent(-1), 0); assert.equal(percent(3), 100)
  assert.equal(levelOf('35'), 0.35); assert.equal(levelOf(120), 1); assert.equal(levelOf('abc'), 0); assert.equal(levelOf(-5), 0)
})

test('a control stores the right preference and nothing else', () => {
  assert.deepEqual(change('on', false), { on: false })
  assert.deepEqual(change('quiet', true), { quiet: true })
  assert.deepEqual(change('effects', '40'), { effects: 0.4 })
  assert.deepEqual(change('calls', 100), { calls: 1 })
})

test('the section lists a switch for each on/off preference and a slider for each level, with a label and a hint', () => {
  assert.deepEqual(SOUND_SWITCHES.map(s => s.id), ['on', 'quiet'])
  assert.deepEqual(SOUND_SLIDERS.map(s => s.id), ['master', 'effects', 'ambience', 'calls'])
  for (const control of [...SOUND_SWITCHES, ...SOUND_SLIDERS]) { assert.ok(control.label.length > 0 && control.hint.length > 0); assert.ok(control.id in SOUND_DEFAULTS) }
})

test('the defaults are gentle, and the summary says what is heard', () => {
  assert.equal(SOUND_DEFAULTS.on, true); assert.equal(SOUND_DEFAULTS.effects, 0.6); assert.equal(SOUND_DEFAULTS.ambience, 0.35)
  assert.equal(soundSummary(SOUND_DEFAULTS), 'On'); assert.equal(soundSummary({ ...SOUND_DEFAULTS, on: false }), 'Muted')
  assert.equal(soundSummary({ ...SOUND_DEFAULTS, quiet: true }), 'On · quiet'); assert.equal(soundSummary({ ...SOUND_DEFAULTS, master: 0 }), 'Volume is at zero')
})
