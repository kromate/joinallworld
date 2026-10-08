import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Ledger, type EnqueueInput } from './ledger.ts';

const children: EnqueueInput[] = [
  { id: 'parent/nw', kind: 'grid-query', inputHash: 'nw-hash', payload: { cell: 'nw', bounds: [-1, 0, 0, 1] }, maxAttempts: 2, priority: 4 },
  { id: 'parent/ne', kind: 'grid-query', inputHash: 'ne-hash', payload: { cell: 'ne', bounds: [0, 0, 1, 1] }, maxAttempts: 2, priority: 4 },
];
async function fixture(run: (ledger: Ledger) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'world-ledger-subdivision-'));
  const ledger = new Ledger(path.join(dir, 'jobs.sqlite'));
  try { await run(ledger); } finally { ledger.close(); await rm(dir, { recursive: true, force: true }); }
}
function addParent(ledger: Ledger, attempts = 2): void { ledger.enqueue({ id: 'parent', kind: 'grid-query', inputHash: 'root-hash', payload: { request: 'root' }, maxAttempts: attempts }); }

test('atomically rolls back earlier child inserts when a later child identity conflicts', async () => fixture(ledger => {
  addParent(ledger);
  ledger.enqueue({ ...children[1]!, payload: { different: true } });
  const parent = ledger.claim('runner', 10, 100)!;
  assert.throws(() => ledger.completeAndEnqueue(parent.id, parent.token, 11, { status: 'subdivided' }, children), /different payload/);
  const jobs = ledger.list();
  assert.equal(jobs.find(job => job.id === 'parent')?.status, 'leased');
  assert.equal(jobs.some(job => job.id === children[0]!.id), false, 'the first child insert must roll back');
  assert.deepEqual(jobs.find(job => job.id === children[1]!.id)?.payload, { different: true });
}));

test('rejects a stale lease without inserting any children', async () => fixture(ledger => {
  addParent(ledger);
  const parent = ledger.claim('runner', 10, 10)!;
  assert.equal(ledger.completeAndEnqueue(parent.id, parent.token, 20, { status: 'subdivided' }, children), false);
  assert.equal(ledger.list().length, 1);
  assert.equal(ledger.list()[0]?.status, 'leased');
}));

test('accepts identical pre-existing deterministic children and completes the live parent once', async () => fixture(ledger => {
  addParent(ledger);
  for (const child of children) ledger.enqueue(child);
  const parent = ledger.claim('runner', 10, 100)!;
  assert.equal(ledger.completeAndEnqueue(parent.id, parent.token, 11, { status: 'subdivided', childIds: children.map(child => child.id) }, children), true);
  const rows = ledger.list();
  assert.equal(rows.length, 3);
  assert.equal(rows.find(job => job.id === 'parent')?.status, 'completed');
  assert.deepEqual(rows.filter(job => job.id !== 'parent').map(job => job.id), children.map(child => child.id).sort());
  assert.equal(ledger.completeAndEnqueue(parent.id, parent.token, 12, { status: 'subdivided' }, children), false);
  assert.equal(ledger.list().length, 3);
}));

test('validates the complete bounded child batch before touching the parent', async () => fixture(ledger => {
  addParent(ledger);
  const parent = ledger.claim('runner', 10, 100)!;
  assert.throws(() => ledger.completeAndEnqueue(parent.id, parent.token, 11, {}, [...children, ...children, ...children]), /at most four/);
  assert.throws(() => ledger.completeAndEnqueue(parent.id, parent.token, 11, {}, [{ ...children[0]!, payload: { bad: Number.NaN } }]), /finite/);
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  assert.throws(() => ledger.completeAndEnqueue(parent.id, parent.token, 11, {}, [{ ...children[0]!, payload: cyclic }]), /cycles/);
  assert.equal(ledger.list().length, 1);
  assert.equal(ledger.list()[0]?.status, 'leased');
}));
