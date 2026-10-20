// Reduce shake: the player's choice wins, else the system setting.
import test from 'node:test'
import assert from 'node:assert/strict'
import { reduceShakeOn } from './reduce.ts'

test('reduce shake follows the system until the player chooses', () => {
  assert.equal(reduceShakeOn({ reduceShake: null }, true), true)
  assert.equal(reduceShakeOn({ reduceShake: null }, false), false)
  assert.equal(reduceShakeOn({ reduceShake: false }, true), false)
  assert.equal(reduceShakeOn({ reduceShake: true }, false), true)
})
