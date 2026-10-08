import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, symlink, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ledger } from './ledger.ts';
import { createOutputStore } from './storage.ts';

test('ledger deduplicates exact enqueue and rejects mismatched payloads', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'world-ledger-'));
  const ledger = new Ledger(path.join(dir, 'queue.sqlite'));
  try {
    ledger.enqueue({ id: 'a', kind: 'compile', inputHash: 'abc', payload: { z: 2, a: 1 }, maxAttempts: 2 });
    ledger.enqueue({ id: 'a', kind: 'compile', inputHash: 'abc', payload: { a: 1, z: 2 }, maxAttempts: 2 });
    assert.throws(() => ledger.enqueue({ id: 'a', kind: 'compile', inputHash: 'abc', payload: { a: 3 }, maxAttempts: 2 }), /different payload/);
    const claimed = ledger.claim('worker-1', 10, 100);
    assert.deepEqual(claimed, { id: 'a', kind: 'compile', inputHash: 'abc', payload: { a: 1, z: 2 }, attempt: 1, token: '1:worker-1', leaseUntil: 110 });
  } finally { ledger.close(); await rm(dir, { recursive: true, force: true }); }
});

test('expired worker crashes consume attempts and tokens fence stale workers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'world-ledger-'));
  const ledger = new Ledger(path.join(dir, 'queue.sqlite'));
  try {
    ledger.enqueue({ id: 'crash', kind: 'compile', inputHash: 'h', payload: null, maxAttempts: 2 });
    const first = ledger.claim('one', 0, 5)!;
    assert.equal(ledger.heartbeat(first.id, first.token, 5, 10), false);
    const second = ledger.claim('two', 5, 5)!;
    assert.equal(second.attempt, 2);
    assert.notEqual(first.token, second.token);
    assert.equal(ledger.complete(first.id, first.token, 6, {}), false);
    assert.equal(ledger.claim('three', 10, 5), null);
    assert.equal(ledger.list()[0]?.status, 'failed');
  } finally { ledger.close(); await rm(dir, { recursive: true, force: true }); }
});

test('fail supports bounded retry then completion', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'world-ledger-'));
  const ledger = new Ledger(path.join(dir, 'queue.sqlite'));
  try {
    ledger.enqueue({ id: 'retry', kind: 'compile', inputHash: 'h', payload: {}, maxAttempts: 2 });
    const one = ledger.claim('one', 0, 100)!;
    assert.equal(ledger.fail(one.id, one.token, 1, new Error('temporary'), 20), true);
    const two = ledger.claim('two', 21, 100)!;
    assert.equal(two.attempt, 2);
    assert.equal(ledger.complete(two.id, two.token, 22, { ok: true }), true);
    assert.equal(ledger.list()[0]?.status, 'completed');
  } finally { ledger.close(); await rm(dir, { recursive: true, force: true }); }
});

test('output store contains paths, verifies immutable collisions and refuses symlinks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'world-store-'));
  const root = path.join(dir, 'build');
  const outside = path.join(dir, 'outside');
  const store = await createOutputStore(root, dir);
  try {
    await store.writeImmutable('tiles/one.json', new Uint8Array([1, 2, 3]));
    await store.writeImmutable('tiles/one.json', new Uint8Array([1, 2, 3]));
    await assert.rejects(store.writeImmutable('tiles/one.json', new Uint8Array([3])), /collision/);
    assert.deepEqual(await readFile(path.join(root, 'tiles/one.json')), Buffer.from([1, 2, 3]));
    await assert.rejects(store.writeAtomic('../outside', new Uint8Array()), /path traversal/);
    await assert.rejects(createOutputStore(dir, dir), /dedicated/);
    await symlink(outside, path.join(root, 'escape'));
    await assert.rejects(store.writeAtomic('escape/file.json', new Uint8Array([1])), /symlink|escapes/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('immutable publication tolerates an abandoned partial staging file and concurrent publishers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'world-store-'));
  const root = path.join(dir, 'build');
  const store = await createOutputStore(root, dir);
  try {
    await mkdir(path.join(root, 'tiles'));
    await writeFile(path.join(root, 'tiles', '.stable.json.abandoned.tmp'), Buffer.from([8, 8]));
    const contents = new Uint8Array([1, 2, 3, 4, 5]);
    const publishers = await Promise.all([
      store.writeImmutable('tiles/stable.json', contents),
      store.writeImmutable('tiles/stable.json', contents),
    ]);
    assert.equal(publishers[0], publishers[1]);
    assert.deepEqual(await readFile(path.join(root, 'tiles/stable.json')), Buffer.from(contents));
    await assert.rejects(store.writeImmutable('tiles/stable.json', new Uint8Array([5, 4, 3])), /collision/);
    assert.deepEqual(await readFile(path.join(root, 'tiles/stable.json')), Buffer.from(contents));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
