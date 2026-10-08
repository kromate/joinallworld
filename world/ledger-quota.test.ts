import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ledger } from './ledger.ts';

test('bounded ledger rejects a full transaction without retaining its job and resumes within its database/WAL quota', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fine-ledger-quota-'));
  const file = path.join(root, 'jobs.sqlite');
  let ledger: Ledger | undefined;
  try {
    ledger = new Ledger(file, { databaseBytes: 64 * 1024 });
    ledger.enqueue({ id: 'kept', kind: 'fine', inputHash: 'a', payload: { source: 'small' }, maxAttempts: 2 });
    assert.throws(() => ledger!.enqueue({ id: 'oversized', kind: 'fine', inputHash: 'b', payload: 'x'.repeat(128 * 1024), maxAttempts: 2 }), /full/i);
    assert.deepEqual(ledger.list().map(row => row.id), ['kept']);
    assert.ok((await stat(file)).size <= 64 * 1024);
    assert.equal((await stat(`${file}-wal`)).size, 0);
    const job = ledger.claim('one', 0, 100)!;
    assert.equal(ledger.complete(job.id, job.token, 1, { manifestHash: 'verified' }), true);
    ledger.close(); ledger = undefined;
    ledger = new Ledger(file, { databaseBytes: 64 * 1024 });
    assert.equal(ledger.list()[0]!.status, 'completed');
    assert.equal(ledger.claim('two', 2, 100), null);
    assert.ok((await stat(file)).size <= 64 * 1024);
    assert.equal((await stat(`${file}-wal`)).size, 0);
  } finally { ledger?.close(); await rm(root, { recursive: true, force: true }); }
});

test('bounded ledger rejects reopening an existing database that already exceeds the requested quota', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fine-ledger-existing-quota-'));
  const file = path.join(root, 'jobs.sqlite');
  try {
    const existing = new Ledger(file);
    try { existing.enqueue({ id: 'large', kind: 'fine', inputHash: 'c', payload: 'x'.repeat(128 * 1024), maxAttempts: 1 }); }
    finally { existing.close(); }
    assert.throws(() => new Ledger(file, { databaseBytes: 64 * 1024 }), /exceeds its page quota/);
    const restored = new Ledger(file);
    try { assert.equal(restored.list().length, 1); }
    finally { restored.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
