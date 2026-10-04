// OWNER: accounts — tests for server/auth.ts and server/routes/auth.ts (inert until the accounts design is reviewed).
// Pattern and rules: see "HOW TO TEST" at the top of server/routes/index.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';

test('accounts endpoints: nothing is exposed yet and core routes are unaffected', async t => {
  const f = await fixture(t);
  const ada = await f.device('Ada');
  assert.equal((await f.request('/api/auth/anything', null, ada.cookie)).status, 404);
  assert.equal((await f.request('/api/life?city=lagos', null, ada.cookie)).status, 200);
});
