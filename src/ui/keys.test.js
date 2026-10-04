import test from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCUTS, shortcutFor, shortcutRows } from './keys.js';

test('shortcut map matches the documented keys and resolves events', () => {
  const run = key => shortcutFor({ key })?.run;
  assert.deepEqual(['m', 'H', 'b', 'p', 's', 't', 'e', 'r', 'c', '?', 'Escape', 'Enter', 'Delete'].map(run),
    ['open:map', 'nav:home', 'open:buy', 'open:phone', 'open:sim', 'toggle:activities', 'open:people', 'key:rotate', 'key:catalogue', 'help', 'close', 'key:place', 'key:sell']);
  for (let n = 1; n <= 9; n++) assert.equal(run(String(n)), `spot:${n}`);
  assert.deepEqual(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map(run), ['key:move-up', 'key:move-down', 'key:move-left', 'key:move-right']);
  assert.equal(shortcutFor({ key: 'm', ctrlKey: true }), undefined); assert.equal(run('z'), undefined);
  const keys = SHORTCUTS.flatMap(shortcut => shortcut.keys);
  assert.equal(new Set(keys).size, keys.length, 'no key is bound twice');
  assert.ok(shortcutRows().some(row => row.label === '1–9')); assert.equal(shortcutRows().filter(row => row.description === 'Move furniture').length, 1);
});
