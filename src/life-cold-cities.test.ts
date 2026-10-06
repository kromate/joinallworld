import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

// A life with a home in each city, rebuilt in a process where only the current city's content is loaded.
const script = (current: string, other: string): string => `
  import { loadCityContent } from './src/game/cities/registry.ts';
  import { createLife } from './src/life.ts';
  const away = { lga: ${other === 'lagos' ? "'ikeja'" : "'ibadan-north'"}, tier: 'starter', living: 'rent', house: ${other === 'lagos' ? "'mushin'" : "'ibadan-mokola-room'"} };
  const raw = { cash: 9000, job: 'tech', career: { city: '${other}' }, missions: { visited: { week: 0, list: ['${other}:home', 'cocoa-house'] } },
    events: { attended: ['${other}:market:3', 'market:4'] }, estate: { city: '${current}', lga: ${current === 'lagos' ? "'ikeja'" : "'ibadan-north'"}, away: { '${other}': away } } };
  await Promise.all([loadCityContent('lagos'), loadCityContent('ibadan')]);
  const rebuilt = createLife(raw, { cityId: '${current}', now: 1_800_000_000_000 });
  const stored = JSON.stringify(rebuilt);
  const full = JSON.stringify(createLife(rebuilt, { cityId: '${current}', now: 1_800_000_000_000 }));
  console.log(JSON.stringify({ stored, full }));
`
const cold = (current: string, other: string, stored: string): string => `
  import { cachedCityContent, cityRules } from './src/game/cities/registry.ts';
  import { loadLifeCities } from './src/game/cities/lifeCities.ts';
  import { createLife, viewLife } from './src/life.ts';
  const raw = JSON.parse(${JSON.stringify(stored)});
  await loadLifeCities(raw, ['${current}']);
  const warm = createLife(raw, { cityId: '${current}', now: 1_800_000_000_000 });
  viewLife(warm, { cityId: '${current}', now: 1_800_000_000_000 });
  const again = createLife(JSON.parse(JSON.stringify(warm)), { cityId: '${current}', now: 1_800_000_000_000 });
  console.log(JSON.stringify({ cold: cachedCityContent('${other}') === null, rules: cityRules('${other}') !== null, state: JSON.stringify(warm), again: JSON.stringify(again), cash: warm.cash, same: JSON.stringify(warm) === JSON.stringify(again) }));
`
for (const [current, other] of [['ibadan', 'lagos'], ['lagos', 'ibadan']] as const) {
  test(`a life in ${current} with a home in ${other} rebuilds with only ${current} loaded and keeps that home`, () => {
    const run = (code: string) => { const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { encoding: 'utf8' }); assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout) as Record<string, unknown> }
    const full = run(script(current, other))
    const result = run(cold(current, other, String(full.stored))) as { cold: boolean; rules: boolean; state: string; again: string; cash: number; same: boolean }
    assert.equal(result.cold, true)
    assert.equal(result.rules, true)
    assert.equal(result.cash, 9000)
    assert.equal(result.state, full.stored, 'the whole saved shape matches a fully loaded rebuild')
    assert.equal(result.same, true, 'rebuilding the rebuilt life changes nothing')
    assert.equal(result.again, full.full, 'the cold and fully loaded second rebuilds are identical')
  })
}
