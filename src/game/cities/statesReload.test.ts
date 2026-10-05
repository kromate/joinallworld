import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { advanceLife, createLife, dispatch } from '../../life.ts'
import { DEFAULT_LOOK } from '../content/traits.ts'
import { cityRules, loadCityContent } from './registry.ts'
import type { LifeContextInit, LifeState } from '../../types/life.ts'

const NEW_CITIES = ['port-harcourt', 'abuja', 'kano'] as const
const probePath = new URL('../../../scripts/reload-probe.ts', import.meta.url).pathname

/** A settled Lagos life and the helpers that move it: every trip is the ordinary relocate action, finished on the engine's own clock. */
function traveller(seed: string) {
  let now = Date.UTC(2026, 0, 5, 9)
  const context = (state?: LifeState): LifeContextInit => ({ cityId: state?.estate.city ?? 'lagos', now, seed })
  const state = createLife({ name: 'Reload Traveller' }, { ...context(), isNew: true, quickStart: true })
  const run = (type: string, payload: object) => dispatch(state, { type, payload } as never, context(state))
  const finish = (): void => { const seconds = state.activeAction?.remaining; assert.equal(typeof seconds, 'number'); now += (Number(seconds) + 1) * 1000; advanceLife(state, Number(seconds) + 1, context(state)) }
  const unit = (city: string): string => cityRules(city)!.units[0]!.id
  run('onboarding.quick-start', { look: DEFAULT_LOOK })
  run('onboarding.traits', { traits: ['clean-pikin', 'musical'] })
  run('onboarding.dream', { dream: 'afrobeats-star' })
  run('onboarding.lottery', {})
  assert.equal(run('onboarding.home', { lga: unit('lagos'), via: 'manual' }).code, 'life_started')
  state.cash = 5_000_000
  const go = (to: string, mode = 'road'): void => { assert.equal(run('estate.relocate', { to, mode }).code, 'departed', `a ${mode} trip to ${to}`); finish(); assert.equal(state.estate.city, to) }
  const settle = (city: string): void => { assert.equal(run('estate.set-lga', { lga: unit(city), via: 'manual', home: 'buy' }).code, 'home_bought', `a home in ${city}`) }
  return { state, go, settle, saved: (): string => JSON.stringify({ ...state, t: now }) }
}

/** Read a saved life the way a freshly opened page reads it: in a process where only that city's content is loaded. */
function probe(dir: string, city: string, saved: string): void {
  const file = join(dir, `${city}.json`)
  writeFileSync(file, saved)
  for (const mode of ['trusted', 'untrusted']) {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', probePath, file, city, mode], { encoding: 'utf8' })
    assert.equal(child.status, 0, `${city} (${mode}): ${child.stderr.split('\n').filter(Boolean).slice(0, 3).join(' | ')}`)
    const read = JSON.parse(child.stdout) as { city: string; away: string[] }
    assert.equal(read.city, city, `${city} (${mode}): the life is read in the city it was saved in`)
    assert.ok(read.away.length >= 1, `${city} (${mode}): the homes elsewhere are kept`)
  }
}

for (const city of NEW_CITIES) {
  test(`a life with homes in Lagos and ${cityRules(city)!.name} reloads cleanly in each with only that city loaded`, async () => {
    await Promise.all(['lagos', city].map(loadCityContent))
    const life = traveller(`reload-${city}`)
    life.go(city); life.settle(city); life.go('lagos')
    assert.deepEqual(Object.keys(life.state.estate.away), [city])
    const dir = mkdtempSync(join(tmpdir(), 'allworld-reload-'))
    try {
      for (const at of [city, 'lagos']) { life.go(at); probe(dir, at, life.saved()) }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
}

test('a life with homes in Lagos, Port Harcourt, Abuja and Kano reloads cleanly in each of them with only that city loaded', async () => {
  await Promise.all(['lagos', ...NEW_CITIES].map(loadCityContent))
  const life = traveller('reload-four')
  // Lagos → Port Harcourt by road, on to Abuja by air, on to Kano by road, and home by air: every mode the new cities offer between themselves.
  const round: readonly (readonly [string, string])[] = [['port-harcourt', 'road'], ['abuja', 'air'], ['kano', 'road'], ['lagos', 'air']]
  for (const [to, mode] of round) { life.go(to, mode); if (to !== 'lagos') life.settle(to) }
  assert.deepEqual(Object.keys(life.state.estate.away).sort(), [...NEW_CITIES].sort())
  const dir = mkdtempSync(join(tmpdir(), 'allworld-reload-'))
  try {
    for (const [to, mode] of round) { life.go(to, mode); probe(dir, to, life.saved()) }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
