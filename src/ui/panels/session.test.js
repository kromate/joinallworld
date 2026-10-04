import test from 'node:test';
import assert from 'node:assert/strict';
import session from './session.js';

test('fresh nickname entry is mandatory only until connection; expired saved previews stay dismissible', () => {
  assert.equal(typeof session.required({}, { connected: false, params: { reason: 'new' } }), 'string');
  assert.equal(session.required({}, { connected: true, params: { reason: 'new' } }), null);
  assert.equal(session.required({}, { connected: false, params: { reason: 'expired' } }), null);
  assert.equal(session.required({}, { connected: false }), null);
  const expired = session.render({}, { params: { reason: 'expired' } });
  assert.match(expired, /Keep my saved preview/);
  assert.match(expired, /Start a separate new life/);
});
