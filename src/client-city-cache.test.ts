import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

for (const legacy of [false, true]) {
  test(`a ${legacy ? 'legacy' : 'travelled'} Ibadan cache starts without loading Lagos`, () => {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
      import { loadCityContent, cachedCityContent } from './src/game/cities/registry.ts';
      import { createClient, STORAGE_KEY } from './src/client.ts';
      await loadCityContent('ibadan');
      const saved = { cityId: ${legacy ? "'ibadan'" : "'lagos'"}, identity: { name: 'Cache traveller' }, state: {
        cash: 12345, needs: { hunger: 61, energy: 72 }, ${legacy ? '' : "estate: { city: 'ibadan' },"}
      } };
      const storage = { getItem: key => key === STORAGE_KEY ? JSON.stringify(saved) : null, setItem() {}, removeItem() {} };
      const client = createClient({ storage });
      console.log(JSON.stringify({ city: client.cityId, stateCity: client.state.estate.city, cash: client.state.cash,
        hunger: client.state.needs.hunger, cold: cachedCityContent('lagos') === null }));
      client.stop();
    `], { encoding: 'utf8' })
    assert.equal(child.status, 0, child.stderr)
    assert.deepEqual(JSON.parse(child.stdout), { city: 'ibadan', stateCity: 'ibadan', cash: 12345, hunger: 61, cold: true })
  })
}
