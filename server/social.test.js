// OWNER: social — tests for server/routes/social.js and server/ws/social.js.
// Pattern and rules: see "HOW TO TEST" at the top of server/routes/index.js and server/ws/index.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.js';

test('social endpoints: nothing is exposed yet and core routes are unaffected', async t => {
  const f = await fixture(t);
  const ada = await f.device('Ada');
  assert.equal((await f.request('/api/social/anything', null, ada.cookie)).status, 404);
  assert.equal((await f.request('/api/life?city=lagos', null, ada.cookie)).status, 200);
});
