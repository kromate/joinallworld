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
  const stored = JSON.stringify(createLife(raw, { cityId: '${current}' }).estate.away);
  const full = JSON.stringify(createLife(createLife(raw, { cityId: '${current}' }), { cityId: '${current}' }).estate.away);
  console.log(JSON.stringify({ stored, full }));
`
const cold = (current: string, other: string): string => `
  import { loadCityContent, cachedCityContent } from './src/game/cities/registry.ts';
  import { createLife, viewLife } from './src/life.ts';
  const away = { lga: ${other === 'lagos' ? "'ikeja'" : "'ibadan-north'"}, tier: 'starter', living: 'rent', house: ${other === 'lagos' ? "'mushin'" : "'ibadan-mokola-room'"} };
  const raw = { cash: 9000, job: 'tech', career: { city: '${other}' }, missions: { visited: { week: 0, list: ['${other}:home', 'cocoa-house'] } },
    events: { attended: ['${other}:market:3', 'market:4'] }, estate: { city: '${current}', lga: ${current === 'lagos' ? "'ikeja'" : "'ibadan-north'"}, away: { '${other}': away } } };
  await loadCityContent('${current}');
  const warm = createLife(raw, { cityId: '${current}' });
  viewLife(createLife(raw, { cityId: '${current}' }), { cityId: '${current}' });
  const again = createLife(JSON.parse(JSON.stringify(warm)), { cityId: '${current}' });
  console.log(JSON.stringify({ cold: cachedCityContent('${other}') === null, away: warm.estate.away, again: again.estate.away, cash: warm.cash, same: JSON.stringify(warm.estate.away) === JSON.stringify(again.estate.away) }));
`
for (const [current, other] of [['ibadan', 'lagos'], ['lagos', 'ibadan']] as const) {
  test(`a life in ${current} with a home in ${other} rebuilds with only ${current} loaded and keeps that home`, () => {
    const run = (code: string) => { const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { encoding: 'utf8' }); assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout) as Record<string, unknown> }
    const full = run(script(current, other))
    const result = run(cold(current, other)) as { cold: boolean; away: Record<string, unknown>; again: unknown; cash: number; same: boolean }
    assert.equal(result.cold, true)
    assert.equal(result.cash, 9000)
    assert.equal(JSON.stringify(result.away), full.stored, 'the away home is exactly what a fully loaded rebuild keeps')
    assert.equal(result.same, true, 'rebuilding the rebuilt life changes nothing')
    assert.deepEqual(Object.keys(result.away), [other])
  })
}
