import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { advanceLife, createLife, dispatch } from '../../../life.ts'
import { DEFAULT_LOOK } from '../../content/traits.ts'
import { cityRules, loadCityContent } from '../registry.ts'
import type { LifeContextInit, LifeState } from '../../../types/life.ts'

/** A life that has homes and history in three cities, read again the way a freshly opened page reads it: with only the current city's content loaded. */
test('a life with homes in Lagos, Ota and Abeokuta reloads cleanly in each of them with only that city loaded', async () => {
  await Promise.all(['lagos', 'ota', 'abeokuta'].map(loadCityContent))
  let now = Date.UTC(2026, 0, 5, 9)
  const context = (state?: LifeState): LifeContextInit => ({ cityId: state?.estate.city ?? 'lagos', now, seed: 'reload' })
  const state = createLife({ name: 'Reload Traveller' }, { ...context(), isNew: true, quickStart: true })
  const run = (type: string, payload: object) => dispatch(state, { type, payload } as never, context(state))
  const finish = () => { const seconds = state.activeAction?.remaining; assert.equal(typeof seconds, 'number'); now += (Number(seconds) + 1) * 1000; advanceLife(state, Number(seconds) + 1, context(state)) }
  const unit = (city: string) => cityRules(city)!.units[0]!.id
  run('onboarding.quick-start', { look: DEFAULT_LOOK })
  run('onboarding.traits', { traits: ['clean-pikin', 'musical'] })
  run('onboarding.dream', { dream: 'afrobeats-star' })
  run('onboarding.lottery', {})
  assert.equal(run('onboarding.home', { lga: unit('lagos'), via: 'manual' }).code, 'life_started')
  for (const to of ['ota', 'abeokuta', 'lagos']) {
    assert.equal(run('estate.relocate', { to, mode: 'road' }).code, 'departed', `a road trip to ${to}`)
    finish()
    if (to !== 'lagos') state.cash += 100_000
    if (to !== 'lagos') assert.equal(run('estate.set-lga', { lga: unit(to), via: 'manual', home: 'buy' }).code, 'home_bought')
  }
  assert.deepEqual(Object.keys(state.estate.away).sort(), ['abeokuta', 'ota'])
  const dir = mkdtempSync(join(tmpdir(), 'allworld-reload-'))
  try {
    // The saved copy a page reads is the life as it stood in that city, so one is taken on a second round of trips, in each city in turn.
    for (const city of ['ota', 'abeokuta', 'lagos']) {
      assert.equal(run('estate.relocate', { to: city, mode: 'road' }).code, 'departed', `a second road trip to ${city}`)
      finish()
      assert.equal(state.estate.city, city)
      const file = join(dir, `${city}.json`)
      writeFileSync(file, JSON.stringify({ ...state, t: now }))
      for (const mode of ['trusted', 'untrusted']) {
        const probe = spawnSync(process.execPath, ['--experimental-strip-types', new URL('../../../../scripts/reload-probe.ts', import.meta.url).pathname, file, city, mode], { encoding: 'utf8' })
        assert.equal(probe.status, 0, `${city} (${mode}): ${probe.stderr.split('\n').filter(Boolean).slice(0, 3).join(' | ')}`)
        const read = JSON.parse(probe.stdout) as { rules: boolean; cold: string[] }
        assert.equal(read.rules, true, `${city} (${mode}): every referenced city's rules loaded before rebuild`)
        assert.ok(read.cold.length >= 2, `${city} (${mode}): other city content stayed cold`)
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
