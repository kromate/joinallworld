import test from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCUTS, shortcutFor, shortcutRows, heldActionFor } from './keys.ts';

test('shortcut map matches the documented keys and resolves events', () => {
  const run = (key: string) => shortcutFor({ key })?.run;
  assert.deepEqual(['m', 'H', 'b', 'p', 'i', 't', 'e', 'r', 'c', '?', 'Escape', 'Enter', 'Delete'].map(run),
    ['open:map', 'nav:home', 'open:buy', 'open:phone', 'open:sim', 'toggle:activities', 'open:people', 'key:rotate', 'key:catalogue', 'help', 'close', 'key:place', 'key:sell']);
  for (let n = 1; n <= 9; n++) assert.equal(run(String(n)), `spot:${n}`);
  assert.deepEqual(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map(run), ['key:move-up', 'key:move-down', 'key:move-left', 'key:move-right']);
  assert.equal(shortcutFor({ key: 'm', ctrlKey: true }), undefined); assert.equal(run('z'), undefined);
  const keys = SHORTCUTS.flatMap(shortcut => shortcut.keys);
  assert.equal(new Set(keys).size, keys.length, 'no key is bound twice');
  assert.ok(shortcutRows().some(row => row.label === '1–9'));
});

test('W A S D walk, Shift jogs, the camera has its own keys, and the Sim sheet moved off S', () => {
  const run = (key: string) => shortcutFor({ key })?.run;
  assert.deepEqual(['w', 'a', 's', 'd', 'W', 'S', 'Shift'].map(run), ['walk:up', 'walk:left', 'walk:down', 'walk:right', 'walk:up', 'walk:down', 'walk:jog']);
  assert.equal(SHORTCUTS.filter(shortcut => shortcut.run === 'open:sim').length, 1, 'the Sim sheet has exactly one key');
  assert.deepEqual(SHORTCUTS.find(shortcut => shortcut.run === 'open:sim')!.keys, ['i']);
  assert.deepEqual(['[', ']', 'PageUp', 'PageDown'].map(run), ['look:left', 'look:right', 'look:up', 'look:down']);
  assert.deepEqual(['+', '=', '-', '_', '0'].map(run), ['key:zoom-in', 'key:zoom-in', 'key:zoom-out', 'key:zoom-out', 'key:zoom-fit']);
  assert.deepEqual(['e', 'r'].map(run), ['open:people', 'key:rotate'], 'People and Rotate keep their keys');
  // The help overlay is built from this table: one truthful line per group.
  const rows = shortcutRows(), row = (label: string) => rows.filter(item => item.label === label);
  assert.equal(row('W A S D').length, 1); assert.match(row('W A S D')[0]!.description, /Walk.*Shift/);
  assert.equal(row('← ↑ ↓ →').length, 1); assert.match(row('← ↑ ↓ →')[0]!.description, /Walk.*Buy.*furniture.*map/);
  assert.equal(row('+ − 0').length, 1); assert.match(row('+ − 0')[0]!.description, /Zoom.*recentre/);
  assert.equal(row('I')[0]!.description, 'Your Sim'); assert.equal(row('S').length, 0, 'S is no longer listed on its own');
  assert.ok(rows.every(item => item.label && item.description));
  // A released key is recognised whatever modifiers are down, so nothing can stay held.
  assert.deepEqual([{ key: 'w' }, { key: 'W', shiftKey: true }, { key: 'ArrowLeft', ctrlKey: true }, { key: 'Shift' }, { key: 'PageUp' }, { key: 'm' }, { key: '+' }, {}].map(heldActionFor),
    ['walk-up', 'walk-up', 'move-left', 'walk-jog', 'look-up', undefined, undefined, undefined]);
});
