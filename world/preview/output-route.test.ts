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
  assert.equal(outputRoute(`/fine/rw/adm1/outlines/${hash}.json`)?.limit, 2 * 1024 * 1024);
  assert.equal(outputRoute(`/fine/rw/adm1/node-index/${hash}.json`)?.limit, 128 * 1024);
  assert.deepEqual(outputRoute(`/fine/rw/adm1/topology/${hash}.json`), {
    rootParts: ['output'], assetParts: ['fine', 'rw', 'adm1', 'topology', `${hash}.json`], limit: 64 * 1024,
  });
  for (const pathname of [`/fine/ng/adm1/outlines/${hash}.json`, `/fine/ng/adm1/topology/${hash}.json`, `/fine/rw/adm2/outlines/${hash}.json`,
    '/fine/rw/adm1/source.geojson', '/fine/rw/adm1/attempts/attempt.json', '/fine/rw/adm1/reports/private.json']) assert.equal(outputRoute(pathname), null);
  for (const pathname of ['/campaigns/accra/ledger.sqlite', '/campaigns/accra/source-cache/extract.geojson', `/campaigns/../tiles/${hash}.json`, `/campaigns/accra/tiles/${hash}.json/extra`, `/tiles/${hash.toUpperCase()}.json`, `/campaigns/accra\\evil/tiles/${hash}.json`]) {
    assert.equal(outputRoute(pathname), null, pathname);
  }
});
