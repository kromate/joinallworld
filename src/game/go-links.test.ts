import assert from 'node:assert/strict';
import test from 'node:test';
import { GO_TARGETS, goFrom, goUrl } from './go-links.ts';

test('go links: only names on the fixed list are understood, in either position of the query', () => {
  for (const name of Object.keys(GO_TARGETS)) assert.equal(goFrom(`?go=${name}`), name);
  assert.equal(goFrom('?ref=abcdef0123&go=messages'), 'messages');
  assert.equal(goFrom('?go=messages&x=1'), 'messages');
  for (const bad of ['', '?go=', '?go=admin', '?go=messages/../x', '?go=Messages', '?go=javascript:alert(1)', '?xgo=messages', '?go=messagesmessages', null, undefined, 7]) assert.equal(goFrom(bad), null, String(bad));
  assert.equal(goUrl('https://play.example', 'needs'), 'https://play.example/?go=needs');
});
