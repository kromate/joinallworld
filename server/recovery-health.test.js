import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.js';
test('preview identifies its serving build without creating an identity', async t => {
 const f = await fixture(t, { buildId: 'recovery-test' });
 const response = await f.request('/api/health');
 assert.equal(response.status, 200);
 assert.equal(response.headers.has('set-cookie'), false);
 assert.deepEqual(await response.json(), { ok: true, build: 'recovery-test', serverTime: 100000 });
});
