import test from 'node:test';
import assert from 'node:assert/strict';
import { nextEnabled, typeAhead, keepsNative } from './controls.ts';

const options = [{ label: 'Agege' }, { label: 'Ikeja', disabled: true }, { label: 'Ikorodu' }, { label: 'Lagos Island' }, { label: 'Lagos Mainland' }];

test('arrow keys step over disabled options and stop at the ends', () => {
  assert.equal(nextEnabled(options, 0, 1), 2);
  assert.equal(nextEnabled(options, 2, -1), 0);
  assert.equal(nextEnabled(options, 4, 1), 4);
  assert.equal(nextEnabled(options, 0, -1), 0);
  assert.equal(nextEnabled(options, -1, 1), 0, 'Home');
  assert.equal(nextEnabled(options, options.length, -1), 4, 'End');
});

test('type-ahead goes to the next option that starts with what was typed, wrapping, never to a disabled one', () => {
  assert.equal(typeAhead(options, 0, 'l'), 3);
  assert.equal(typeAhead(options, 3, 'l'), 4);
  assert.equal(typeAhead(options, 4, 'l'), 3, 'wraps round');
  assert.equal(typeAhead(options, 0, 'ik'), 2, 'Ikeja is disabled: Ikorodu');
  assert.equal(typeAhead(options, 2, 'lagos m'), 4);
  assert.equal(typeAhead(options, 1, 'z'), 1, 'no match: stays');
});

test('the platform picker is kept only on a small touch screen', () => {
  const win = (coarse, width) => ({ matchMedia: () => ({ matches: coarse }), innerWidth: width });
  assert.equal(keepsNative(win(true, 390)), true);
  assert.equal(keepsNative(win(true, 1024)), false);
  assert.equal(keepsNative(win(false, 390)), false);
});
