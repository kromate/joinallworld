import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetryableStartup } from './startup-gate.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('a gate miss leaves startup available when eligibility arrives later', async () => {
  let now = 0, loads = 0, ready = 0;
  const gate = createRetryableStartup({ now: () => now });
  assert.equal(gate.start(false, async () => { loads++; return 'module'; }, () => { ready++; }), false);
  assert.equal(gate.pending, false);
  now++;
  assert.equal(gate.start(true, async () => { loads++; return 'module'; }, () => { ready++; }), true);
  await tick();
  assert.deepEqual({ loads, ready, pending: gate.pending }, { loads: 1, ready: 1, pending: false });
});

test('a rejected import can retry after a bounded cooldown, but not on every frame', async () => {
  let now = 10, loads = 0, errors = 0, ready = 0;
  const gate = createRetryableStartup({ cooldownMs: 500, now: () => now });
  assert.equal(gate.start(true, async () => { loads++; throw new Error('chunk unavailable'); }, () => { ready++; }, () => { errors++; }), true);
  await tick();
  assert.equal(gate.start(true, async () => { loads++; return 'module'; }, () => { ready++; }), false);
  now += 499;
  assert.equal(gate.start(true, async () => { loads++; return 'module'; }, () => { ready++; }), false);
  now += 1;
  assert.equal(gate.start(true, async () => { loads++; return 'module'; }, () => { ready++; }), true);
  await tick();
  assert.deepEqual({ loads, errors, ready }, { loads: 2, errors: 1, ready: 1 });
});

test('pending startup deduplicates repeated render calls', async () => {
  let resolveLoad!: (value: string) => void, loads = 0, ready = 0;
  const gate = createRetryableStartup();
  const load = () => { loads++; return new Promise<string>(resolve => { resolveLoad = resolve; }); };
  assert.equal(gate.start(true, load, () => { ready++; }), true);
  await tick();
  for (let frame = 0; frame < 30; frame++) assert.equal(gate.start(true, load, () => { ready++; }), false);
  assert.equal(loads, 1);
  resolveLoad('module');
  await tick();
  assert.deepEqual({ loads, ready, pending: gate.pending }, { loads: 1, ready: 1, pending: false });
});

test('disposing while a chunk is pending prevents mount and disposes a late value', async () => {
  let resolveLoad!: (value: { dispose(): void }) => void, mounts = 0, disposals = 0;
  const gate = createRetryableStartup();
  assert.equal(gate.start(true, () => new Promise(resolve => { resolveLoad = resolve; }), () => { mounts++; }), true);
  await tick();
  gate.dispose();
  resolveLoad({ dispose() { disposals++; } });
  await tick();
  assert.equal(gate.start(true, async () => 'late', () => { mounts++; }), false);
  assert.deepEqual({ mounts, disposals }, { mounts: 0, disposals: 1 });
});

test('persistently ineligible frames never start the optional import', () => {
  const gate = createRetryableStartup();
  let loads = 0;
  for (let frame = 0; frame < 100; frame++) assert.equal(gate.start(false, async () => { loads++; return 'module'; }, () => {}), false);
  assert.equal(loads, 0);
  assert.equal(gate.pending, false);
});
