// OWNER: civic — tests for server/routes/civic.js.
// Pattern and rules: see "HOW TO TEST" at the top of server/routes/index.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.js';

test('civic endpoints: nothing is exposed yet and core routes are unaffected', async t => {
  const f = await fixture(t);
  const ada = await f.device('Ada');
  assert.equal((await f.request('/api/civic/anything', null, ada.cookie)).status, 404);
  assert.equal((await f.request('/api/life?city=lagos', null, ada.cookie)).status, 200);
});
