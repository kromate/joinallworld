import test from 'node:test';
import assert from 'node:assert/strict';
import { outputRoute } from './output-route.ts';

test('preview routes expose only hashed pack and inventory assets, including isolated campaigns', () => {
  const hash = 'a'.repeat(64);
  assert.deepEqual(outputRoute(`/campaigns/accra-real-acceptance/manifests/${hash}.json`), {
    rootParts: ['campaigns', 'accra-real-acceptance', 'output'], assetParts: ['manifests', `${hash}.json`], limit: 2_000_000,
  });
  assert.equal(outputRoute(`/tiles/${hash}.json`)?.limit, 10_000_000);
  assert.equal(outputRoute(`/inventory/nodes/${hash}.json`)?.limit, 128_000);
  for (const pathname of ['/campaigns/accra/ledger.sqlite', '/campaigns/accra/source-cache/extract.geojson', `/campaigns/../tiles/${hash}.json`, `/campaigns/accra/tiles/${hash}.json/extra`, `/tiles/${hash.toUpperCase()}.json`, `/campaigns/accra\\evil/tiles/${hash}.json`]) {
    assert.equal(outputRoute(pathname), null, pathname);
  }
});
