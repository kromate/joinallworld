import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, symlink, mkdir, writeFile, truncate, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

test('kind-filtered claims pause other kinds, preserve priority and retry fencing, and keep unfiltered claims global', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'world-ledger-kinds-'));
  const ledger = new Ledger(path.join(dir, 'queue.sqlite'));
  try {
    ledger.enqueue({ id: 'query-first', kind: 'campaign-grid-query', inputHash: 'q1', payload: null, maxAttempts: 2, priority: 0 });
    ledger.enqueue({ id: 'index-later', kind: 'campaign-index-capture', inputHash: 'i1', payload: null, maxAttempts: 2, priority: 5 });
    ledger.enqueue({ id: 'index-first', kind: 'campaign-index-capture', inputHash: 'i2', payload: null, maxAttempts: 2, priority: 1 });

    const first = ledger.claim('index-worker', 0, 5, { kind: 'campaign-index-capture' })!;
    assert.equal(first.id, 'index-first');
    assert.equal(ledger.list().find((job) => job.id === 'query-first')?.attempt, 0);
    assert.equal(ledger.list().find((job) => job.id === 'index-later')?.attempt, 0);
    assert.equal(ledger.fail(first.id, first.token, 1, new Error('retry'), 6), true);

    // The index phase can continue while the query phase remains paused.
    const next = ledger.claim('index-worker', 2, 5, { kind: 'campaign-index-capture' })!;
    assert.equal(next.id, 'index-later');
    assert.equal(ledger.complete(first.id, first.token, 2, { stale: true }), false);
    assert.equal(ledger.complete(next.id, next.token, 3, { indexed: true }), true);
    assert.equal(ledger.list().find((job) => job.id === 'query-first')?.attempt, 0);

    const retry = ledger.claim('index-worker', 7, 5, { kind: 'campaign-index-capture' })!;
    assert.equal(retry.id, 'index-first');
    assert.equal(retry.attempt, 2);
    assert.notEqual(retry.token, first.token);
    assert.equal(ledger.complete(retry.id, retry.token, 8, { indexed: true }), true);

    // Existing callers without a filter still claim across every kind, in priority order.
    const unfiltered = ledger.claim('legacy-worker', 9, 5)!;
    assert.equal(unfiltered.id, 'query-first');
    assert.equal(unfiltered.kind, 'campaign-grid-query');
  } finally { ledger.close(); await rm(dir, { recursive: true, force: true }); }
});

test('invalid claim filters fail before lease expiration or attempt spending', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'world-ledger-invalid-filter-'));
  const ledger = new Ledger(path.join(dir, 'queue.sqlite'));
  try {
    ledger.enqueue({ id: 'leased-index', kind: 'campaign-index-capture', inputHash: 'i', payload: null, maxAttempts: 2 });
    ledger.enqueue({ id: 'queued-query', kind: 'campaign-grid-query', inputHash: 'q', payload: null, maxAttempts: 2 });
    const leased = ledger.claim('owner', 0, 5, { kind: 'campaign-index-capture' })!;
    let getterCalled = false;
    const accessor = Object.defineProperty({}, 'kind', { enumerable: true, get() { getterCalled = true; throw new Error('getter invoked'); } });
    const hidden = Object.defineProperty({ kind: 'campaign-index-capture' }, 'extra', { value: 1, enumerable: false });
    const nonEnumerableKind = Object.defineProperty({}, 'kind', { value: 'campaign-index-capture', enumerable: false });
    const symbolKey = { kind: 'campaign-index-capture', [Symbol('extra')]: 1 };
    const tooLong = 'x'.repeat(129);
    const invalid: unknown[] = [
      null, [], Object.create(null), { kind: 'campaign-index-capture', extra: true }, accessor, hidden, nonEnumerableKind, symbolKey,
      { kind: '' }, { kind: '   ' }, { kind: tooLong }, { kind: 'campaign\u0000index' }, { kind: 'campaign\u0085index' },
    ];

    for (const filter of invalid) {
      assert.throws(() => ledger.claim('other', 5, 5, filter as never), TypeError);
      const jobs = ledger.list();
      const stillLeased = jobs.find((job) => job.id === 'leased-index');
      assert.equal(stillLeased?.status, 'leased');
      assert.equal(stillLeased?.attempt, 1);
      assert.equal(stillLeased?.leaseUntil, 5);
      assert.equal(jobs.find((job) => job.id === 'queued-query')?.attempt, 0);
    }
    assert.equal(getterCalled, false);
    assert.equal(ledger.complete(leased.id, leased.token, 5, {}), false);

    // A valid filtered claim performs normal global expiry while only selecting the requested kind.
    const query = ledger.claim('query-worker', 5, 5, { kind: 'campaign-grid-query' })!;
    assert.equal(query.id, 'queued-query');
    const expired = ledger.list().find((job) => job.id === 'leased-index');
    assert.equal(expired?.status, 'queued');
    assert.equal(expired?.attempt, 1);
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

test('durable priorities sort claims first and migrate old jobs with priority zero', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'world-ledger-priority-'));
  const file = path.join(dir, 'queue.sqlite');
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE jobs (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, input_hash TEXT NOT NULL, payload TEXT NOT NULL,
      max_attempts INTEGER NOT NULL CHECK(max_attempts > 0), attempt INTEGER NOT NULL DEFAULT 0,
      token_seq INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('queued','leased','completed','failed')),
      available_at REAL NOT NULL DEFAULT 0, lease_until REAL, lease_token TEXT, result TEXT, error TEXT
    ); INSERT INTO jobs(id,kind,input_hash,payload,max_attempts,status) VALUES('legacy','compile','h','null',2,'queued');`);
    legacy.close();
    let ledger = new Ledger(file);
    try {
      assert.equal(ledger.list()[0]?.priority, 0);
      ledger.enqueue({ id: 'later', kind: 'compile', inputHash: 'h', payload: null, maxAttempts: 2, priority: 3 });
      ledger.enqueue({ id: 'first', kind: 'compile', inputHash: 'h', payload: null, maxAttempts: 2, priority: 1 });
      ledger.enqueue({ id: 'legacy', kind: 'compile', inputHash: 'h', payload: null, maxAttempts: 2, priority: 4 });
    } finally { ledger.close(); }
    ledger = new Ledger(file);
    try {
      assert.equal(ledger.claim('worker', 0, 100)?.id, 'first');
      assert.throws(() => ledger.enqueue({ id: 'first', kind: 'compile', inputHash: 'h', payload: null, maxAttempts: 2, priority: 2 }), /cannot change while leased/);
      assert.equal(ledger.claim('worker', 0, 100)?.id, 'later');
      assert.equal(ledger.claim('worker', 0, 100)?.id, 'legacy');
      assert.equal(ledger.claim('worker', 0, 100), null);
    } finally { ledger.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
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


test('read-only ledger status includes live WAL rows without source sidecar or lease changes', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'world-ledger-readonly-'));
  const file=path.join(dir,'queue.sqlite'),ledger=new Ledger(file);
  try{
    ledger.enqueue({id:'wal-only',kind:'campaign-grid-query',inputHash:'raw',payload:{query:'retained'},maxAttempts:2});
    const claim=ledger.claim('owner',0,5)!;
    const names=(await readdir(dir)).sort();
    assert.ok(names.includes('queue.sqlite-wal'));
    const before=await Promise.all(names.map(name=>readFile(path.join(dir,name))));
    const wal=before[names.indexOf('queue.sqlite-wal')]!;assert.ok(wal.length>0);
    const snapshot=Ledger.readOnlyList(file);
    assert.equal(snapshot.length,1);assert.equal(snapshot[0]!.status,'leased');
    assert.equal(snapshot[0]!.attempt,1);assert.equal(snapshot[0]!.leaseUntil,5);
    assert.deepEqual(snapshot[0]!.payload,{query:'retained'});
    assert.deepEqual((await readdir(dir)).sort(),names);
    assert.deepEqual(await Promise.all(names.map(name=>readFile(path.join(dir,name)))),before);
    assert.equal(ledger.complete(claim.id,claim.token,1,{done:true}),true);
  }finally{ledger.close();await rm(dir,{recursive:true,force:true});}
});

test('read-only ledger snapshot refuses oversized database or WAL and symlinked state before SQL',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'world-ledger-readonly-bounds-'));
  const file=path.join(dir,'queue.sqlite');
  try{
    await writeFile(file,Buffer.alloc(0));await truncate(file,64*1024*1024+1);
    assert.throws(()=>Ledger.readOnlyList(file),/unsafe or oversized/);
    await truncate(file,0);await writeFile(`${file}-wal`,Buffer.alloc(0));await truncate(`${file}-wal`,64*1024*1024+1);
    assert.throws(()=>Ledger.readOnlyList(file),/unsafe or oversized/);
    await rm(`${file}-wal`);await symlink(file,`${file}-wal`);
    assert.throws(()=>Ledger.readOnlyList(file),/unsafe or oversized/);
    await rm(`${file}-wal`);await symlink(file,path.join(dir,'link.sqlite'));
    assert.throws(()=>Ledger.readOnlyList(path.join(dir,'link.sqlite')),/unsafe or oversized/);
    assert.deepEqual((await readdir(dir)).sort(),['link.sqlite','queue.sqlite']);
  }finally{await rm(dir,{recursive:true,force:true});}
});
