import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Actions read every city's content strictly, so a host must have all of it before it serves anything.
test('the Node host has every registered city loaded once it is up', () => {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import { mkdtemp, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { createServer } from './server/server.ts';
    import { registeredCityIds, cachedCityContent } from './src/game/cities/registry.ts';
    const dir = await mkdtemp(join(tmpdir(), 'startup-content-'));
    const server = await createServer({ dataDir: dir });
    const loaded = registeredCityIds().map(id => [id, cachedCityContent(id) !== null]);
    await server.store.close?.();
    await rm(dir, { recursive: true, force: true });
    console.log(JSON.stringify(loaded));
    process.exit(0);
  `], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  const loaded = JSON.parse(child.stdout) as [string, boolean][]
  assert.ok(loaded.length >= 2)
  assert.deepEqual(loaded.filter(([, ok]) => !ok), [])
})

test('the Worker host loads every registered city before it serves', () => {
  const source = readFileSync(new URL('../deploy/cloudflare-worker.ts', import.meta.url), 'utf8')
  assert.match(source, /startup: registeredCityIds\(\)\.map\(loadCityContent\)/)
  assert.match(source, /await Promise\.all\(context\.startup\.splice\(0\)\)/)
})
