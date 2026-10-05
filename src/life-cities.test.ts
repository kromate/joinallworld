import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { lifeCities } from './game/cities/lifeCities.ts'

const run = (code: string): Record<string, unknown> => {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  return JSON.parse(child.stdout) as Record<string, unknown>
}

const twoCityLife = `{ cash: 500, job: 'tech', career: { city: 'lagos' },
  social: { rel: { ada: { p: 3, npc: true, npcSnapshot: { city: 'lagos' } } } }, missions: { visited: { week: 0, list: ['lagos:home', 'ibadan:home'] } },
  estate: { city: 'ibadan', lga: 'ibadan-north', away: { lagos: { lga: 'ikeja', tier: 'starter', living: 'rent', house: 'mushin' } } } }`

test('lifeCities names every registered city a life refers to and nothing else', () => {
  assert.deepEqual(lifeCities({ estate: { city: 'ibadan', away: { lagos: {}, nowhere: {} } }, career: { city: 'lagos' } }), ['ibadan', 'lagos'])
  assert.deepEqual(lifeCities({ estate: { city: 'lagos' }, missions: { visited: { list: ['ibadan:market', 'plain', 'kaduna:x'] } }, events: { attended: ['ibadan:fair:3'] } }), ['lagos', 'ibadan'])
  assert.deepEqual(lifeCities({ social: { rel: { x: { npcSnapshot: { city: 'ibadan' } } } } }), ['ibadan'])
  assert.deepEqual(lifeCities(null), [])
  assert.deepEqual(lifeCities('text'), [])
})

test('a server answer for a two-home life loads both cities before it is rebuilt', () => {
  const result = run(`
    import { loadCityContent, cachedCityContent } from './src/game/cities/registry.ts';
    import { createClient } from './src/client.ts';
    const life = ${twoCityLife};
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const session = { id: '00000000-0000-4000-8000-000000000001', name: 'Tester', cities: ['lagos', 'ibadan'] };
    await loadCityContent('ibadan');
    const stored = { version: 1, cityId: 'ibadan', identity: { name: 'Tester' }, state: life };
    const seen = [];
    const client = createClient({ storage: { getItem: () => JSON.stringify(stored), setItem: (_k, v) => seen.push(v) },
      setTimeout: () => 0, clearTimeout: () => {},
      fetch: async path => path === '/api/session' ? json({ session, serverTime: 1 }) : json({ state: life, serverTime: 1 }) });
    const cold = cachedCityContent('lagos') === null;
    const ok = await client.connect();
    console.log(JSON.stringify({ cold, ok, lagos: cachedCityContent('lagos') !== null, city: client.state.estate.city, away: Object.keys(client.state.estate.away) }));
    client.stop();
  `)
  assert.deepEqual(result, { cold: true, ok: true, lagos: true, city: 'ibadan', away: ['lagos'] })
})

test('the boot path loads every city a cached two-home life refers to', () => {
  const result = run(`
    import { cachedCityContent } from './src/game/cities/registry.ts';
    import { loadLifeCities } from './src/game/cities/lifeCities.ts';
    import { createLife } from './src/life.ts';
    const life = ${twoCityLife};
    const failed = await loadLifeCities(life, ['ibadan']);
    const rebuilt = createLife(life, { cityId: 'ibadan' });
    const unknown = await loadLifeCities({ estate: { city: 'ibadan', away: { 'port-harcourt': {}, nowhere: {} } } });
    console.log(JSON.stringify({ failed, both: [cachedCityContent('lagos') !== null, cachedCityContent('ibadan') !== null], away: Object.keys(rebuilt.estate.away), unknown }));
  `)
  assert.deepEqual(result, { failed: [], both: [true, true], away: ['lagos'], unknown: [] })
})
