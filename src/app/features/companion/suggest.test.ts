import test from 'node:test';
import assert from 'node:assert/strict';
import { SUGGEST_IDS, factsOf, suggestToAction, validateSuggest } from './suggest.ts';
import { ctx } from './testFixtures.ts';

const online = ctx({ friends: [{ id: 'f1', name: 'Bola', online: true }, { id: 'f2', name: 'Tunde', online: false }] });

test('only listed ids that are true in the game survive, once each, at most three', () => {
  const facts = factsOf(ctx());
  assert.deepEqual(validateSuggest(['open-jobs', 'open-jobs', 'nope', 'open-map-venue:park', 'open-map-venue:ghost', 'start-trip:abuja'], facts), ['open-jobs', 'open-map-venue:park', 'start-trip:abuja']);
  assert.deepEqual(validateSuggest(['start-trip:lagos', 'start-trip:atlantis', 'show-tour:money', 'show-tour:x', 'call-friend'], facts), ['show-tour:money'], 'here, unknown, bad tour, nobody online');
  assert.deepEqual(validateSuggest(['call-friend'], factsOf(online)), ['call-friend']);
  assert.deepEqual(validateSuggest('open-jobs', facts), []);
  assert.deepEqual(validateSuggest([1, null, {}, 'open-jobs'], facts), ['open-jobs']);
});

test('every plain id maps to an action; a checked id and its action agree', () => {
  for (const id of SUGGEST_IDS) {
    const action = suggestToAction(id, online);
    assert.ok(action, id);
  }
  assert.equal(suggestToAction('call-friend', ctx()), null);
  assert.deepEqual(suggestToAction('open-jobs', online), { kind: 'open', id: 'jobs', label: 'Open Jobs', params: { section: 'list' } });
  assert.deepEqual(suggestToAction('start-trip:abuja', online), { kind: 'world', city: 'abuja', label: 'Take me there' });
  assert.deepEqual(suggestToAction('open-map-venue:park', online), { kind: 'map', venue: 'park', label: 'Show Freedom Park' });
  assert.deepEqual(suggestToAction('show-tour:travel', online), { kind: 'tour', tour: 'travel', label: 'Show me travel' });
  assert.deepEqual(suggestToAction('call-friend', online), { kind: 'call', friend: 'f1', name: 'Bola', label: 'Call Bola' });
  assert.equal(suggestToAction('open-map-venue:ghost', online), null);
  assert.equal(suggestToAction('transfer-money', online), null);
});
