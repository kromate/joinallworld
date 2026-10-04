import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './store.js';
import { flakyDisk } from './test-fixture.js';

async function temp(t, options) {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-store-'));
  const store = await createStore(dir, options);
  t.after(async () => { await store.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); });
  return { dir, store, file: async () => JSON.parse(await readFile(join(dir, 'devices.json'), 'utf8')) };
}
const session = (publicId, extra = {}) => ({ secret: `s-${publicId}`, publicId, name: publicId, expiresAt: 1000, cities: {}, actions: {}, ...extra });
const unavailable = (error) => error.code === 'storage_unavailable' && error.status === 503 && typeof error.reason === 'string';

test('a durable transaction is in the file when it resolves, and a throw changes nothing', async (t) => {
  const { store, file } = await temp(t);
  await store.transact((db) => { db.sessions.a = session('pa'); db.social = { players: { pa: { name: 'Ada' } } }; });
  assert.deepEqual((await file()).sessions.a.publicId, 'pa');
  assert.equal((await file()).social.players.pa.name, 'Ada');
  await assert.rejects(store.transact((db) => { db.sessions.a.name = 'Changed'; db.sessions.b = session('pb'); db.social.players.pa.name = 'Changed'; delete db.sessions.a; throw new Error('abort'); }), /abort/);
  assert.deepEqual(await store.read((db) => [db.sessions.a.name, db.sessions.b, db.social.players.pa.name, Object.keys(db.sessions)]), ['pa', undefined, 'Ada', ['a']]);
  assert.equal((await file()).sessions.a.name, 'pa');
  assert.equal(store.stats().aborted, 1);
});

test('a read works on a copy and never writes', async (t) => {
  const { store, file } = await temp(t);
  await store.transact((db) => { db.sessions.a = session('pa'); });
  const writes = store.stats().writes;
  const seen = await store.read((db) => { db.sessions.a.name = 'Mutated by a reader'; db.sessions.z = session('pz'); db.extra = { x: 1 }; return db.sessions.a.name; });
  assert.equal(seen, 'Mutated by a reader');
  assert.deepEqual(await store.read((db) => [db.sessions.a.name, db.sessions.z, db.extra, 'extra' in db]), ['pa', undefined, undefined, false]);
  assert.equal(store.stats().writes, writes);
  assert.equal((await file()).sessions.a.name, 'pa');
});

test('there is one store: the removed legacy mode is refused, not silently accepted', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(createStore(dir, { mode: 'legacy' }), /one store now/);
});
test('the file is exactly the JSON of the document, whatever was touched', async (t) => {
  const { store, file, dir } = await temp(t);
  await store.transact((db) => {
    db.sessions['k"1'] = session('p1', { cities: { lagos: { state: { cash: 5 } } } });
    db.sessions.k2 = session('p2');
    db.archivedLives ||= {};
    db.archivedLives.p0 = { publicId: 'p0', name: 'Gone' };
    db.civic = { v: 1 };
  });
  await store.transact((db) => { db.sessions.k2.name = 'Bola'; delete db.sessions['k"1']; db.civic.v = 2; });
  const expected = { version: 1, sessions: { k2: session('p2', { name: 'Bola' }) }, archivedLives: { p0: { publicId: 'p0', name: 'Gone' } }, civic: { v: 2 } };
  assert.deepEqual(await file(), expected);
  // A new store reading that file sees the same document.
  await store.close();
  const again = await createStore(dir);
  assert.deepEqual(await again.read((db) => JSON.parse(JSON.stringify(db))), expected);
  await again.close();
});

test('the session map behaves like the plain object it replaces', async (t) => {
  const { store } = await temp(t);
  await store.transact((db) => { db.sessions.a = session('pa'); db.sessions.b = session('pb'); });
  await store.transact((db) => {
    assert.deepEqual(Object.keys(db.sessions), ['a', 'b']);
    assert.deepEqual(Object.values(db.sessions).map((item) => item.publicId), ['pa', 'pb']);
    assert.deepEqual(Object.entries(db.sessions).map(([key, item]) => [key, item.name]), [['a', 'pa'], ['b', 'pb']]);
    assert.equal(Object.hasOwn(db.sessions, 'a'), true); assert.equal('zz' in db.sessions, false); assert.equal(db.sessions.zz, undefined);
    assert.equal(db.sessions.a, db.sessions.a, 'one copy per transaction');
    db.sessions.c = session('pc'); delete db.sessions.a;
    assert.deepEqual(Object.keys(db.sessions), ['b', 'c']);
    assert.equal(db.$store.sessionKeyByPublicId('pc'), 'c'); assert.equal(db.$store.sessionKeyByPublicId('pa'), undefined); assert.equal(db.$store.sessionKeyByPublicId('pb'), 'b');
    assert.deepEqual(db.$store.scanSessions((record) => record.expiresAt <= 1000).sort(), ['b', 'c']);
    assert.deepEqual(Object.keys(db).sort(), ['sessions', 'version']);
    assert.equal(structuredClone(db.sessions.b).publicId, 'pb', 'records are plain objects');
  });
  assert.deepEqual(await store.read((db) => [db.$store.sessionKeyByPublicId('pa'), db.$store.sessionKeyByPublicId('pc')]), [undefined, 'c']);
});

test('transactions committed while a write is in flight share the next write', async (t) => {
  const { store, file } = await temp(t);
  await store.transact((db) => { for (let i = 0; i < 50; i++) db.sessions[`k${i}`] = session(`p${i}`); });
  const before = store.stats().writes;
  await Promise.all(Array.from({ length: 50 }, (unused, i) => store.transact((db) => { db.sessions[`k${i}`].name = `renamed ${i}`; })));
  const used = store.stats().writes - before;
  assert.ok(used >= 1 && used <= 5, `50 concurrent transactions took ${used} writes`);
  const stored = await file();
  for (let i = 0; i < 50; i++) assert.equal(stored.sessions[`k${i}`].name, `renamed ${i}`);
});

test('a lazy transaction resolves before the disk and is written within the lazy interval; durable can be decided by the result', async (t) => {
  const { store, file } = await temp(t, { lazyFlushMs: 40 });
  await store.transact((db) => { db.sessions.a = session('pa'); });
  const writes = store.stats().writes;
  await store.transact((db) => { db.sessions.a.name = 'lazy'; }, { durable: false });
  assert.equal(store.stats().writes, writes, 'nothing was written yet');
  assert.equal((await file()).sessions.a.name, 'pa');
  assert.equal(await store.read((db) => db.sessions.a.name), 'lazy', 'memory already has it');
  await new Promise((done) => setTimeout(done, 120));
  assert.equal((await file()).sessions.a.name, 'lazy');
  assert.equal(store.stats().writes, writes + 1);
  // Decided by the result: false is lazy, true is on disk when it resolves.
  await store.transact((db) => { db.sessions.a.name = 'quiet'; return { material: false }; }, { durable: (result) => result.material });
  assert.equal((await file()).sessions.a.name, 'lazy');
  await store.transact((db) => { db.sessions.a.name = 'outcome'; return { material: true }; }, { durable: (result) => result.material });
  assert.equal((await file()).sessions.a.name, 'outcome');
  // A transaction that changed nothing costs no write at all.
  const quiet = store.stats().writes;
  await store.transact(() => 'nothing');
  await store.flush();
  assert.equal(store.stats().writes, quiet);
});

test('close writes what is pending, and an unreadable file is refused at start', async (t) => {
  const { store, file, dir } = await temp(t, { lazyFlushMs: 60000 });
  await store.transact((db) => { db.sessions.a = session('pa'); }, { durable: false });
  await store.close();
  assert.equal((await file()).sessions.a.publicId, 'pa');
  await writeFile(join(dir, 'devices.json'), '{"version":2,"sessions":{}}');
  await assert.rejects(createStore(dir), /Invalid device database/);
});

test('a failed write has NO effect: every transaction in the failed batch and every one applied on top of it is rejected and undone', async (t) => {
  const disk = flakyDisk(), logged = [];
  const { store, file, dir } = await temp(t, { io: disk.io, log: (line) => logged.push(line) });
  await store.transact((db) => { db.sessions.a = session('pa', { cash: 5000 }); db.social = { players: {} }; });
  const before = await file();

  // Hold one good write so that three debits pile up behind it and share the NEXT write (one batch).
  const release = disk.hold();
  const first = store.transact((db) => { db.sessions.a.name = 'kept'; });
  const hooks = [];
  const batch = [1, 2, 3].map((n) => store.transact((db) => { db.sessions.a.cash -= 500; db.sessions[`new${n}`] = session(`pn${n}`); db.social.players[`pn${n}`] = { name: 'x' }; return n; }, { committed: (value) => hooks.push(value) }));
  await new Promise((done) => setTimeout(done, 10)); // the three are applied in memory, behind the held write
  // Held again: the next write is the one that carries the batch. It will fail.
  const releaseBatch = disk.hold();
  release();
  await first;
  disk.fail = 'ENOSPC';
  // Two more are applied while that write is in flight: they were computed on top of the batch.
  const late = store.transact((db) => { db.sessions.a.cash -= 1; return 'late'; }, { committed: (value) => hooks.push(value) });
  const lazy = await store.transact((db) => { db.sessions.a.name = 'lazy rename'; return 'lazy'; }, { durable: false, committed: (value) => hooks.push(value) });
  assert.equal(lazy, 'lazy', 'a lazy transaction resolves at once');
  releaseBatch();
  const results = await Promise.allSettled([...batch, late]);
  for (const result of results) { assert.equal(result.status, 'rejected'); assert.ok(unavailable(result.reason), 'rejected as storage_unavailable (503) with a reason'); }
  assert.deepEqual(hooks, [], 'no commit listener ran for an undone transaction');

  // Memory is exactly what the file holds: the one good write, none of the failed ones.
  assert.deepEqual(await store.read((db) => [db.sessions.a.cash, db.sessions.a.name, Object.keys(db.sessions), Object.keys(db.social.players), db.$store.sessionKeyByPublicId('pn1')]),
    [5000, 'kept', ['a'], [], undefined]);
  assert.deepEqual(await file(), { ...before, sessions: { a: { ...before.sessions.a, name: 'kept' } } });
  const stats = store.stats();
  assert.equal(stats.failing, true); assert.equal(stats.writeFailures, 1); assert.equal(stats.undone, 5);
  assert.equal(logged.length, 1); assert.match(logged[0], /^Store write failed \(ENOSPC\)/);

  // Still failing: reads keep working, each new transaction is rejected and leaves nothing behind.
  for (let i = 0; i < 3; i++) await assert.rejects(store.transact((db) => { db.sessions.a.cash -= 500; }), unavailable);
  assert.equal(await store.read((db) => db.sessions.a.cash), 5000);
  assert.equal(logged.length, 1, 'an outage is logged once, not once per failed write');

  // Writes work again: nothing from the outage reappears, the next transaction is applied once and saved.
  disk.fail = null;
  await store.transact((db) => { db.sessions.a.cash -= 500; });
  assert.equal((await file()).sessions.a.cash, 4500);
  assert.equal(store.stats().failing, false);
  // A restart reads the same thing.
  await store.close();
  const again = await createStore(dir);
  assert.deepEqual(await again.read((db) => [db.sessions.a.cash, db.sessions.a.name, Object.keys(db.sessions)]), [4500, 'kept', ['a']]);
  await again.close();
});

test('a failed write undoes deletions, replaced maps and new collections too', async (t) => {
  const disk = flakyDisk();
  const { store, file } = await temp(t, { io: disk.io, log: () => {} });
  await store.transact((db) => { db.sessions.a = session('pa'); db.sessions.b = session('pb'); db.archivedLives = { old: { publicId: 'old' } }; db.civic = { v: 1 }; });
  const before = await file();
  disk.fail = 'EIO';
  await assert.rejects(store.transact((db) => { delete db.sessions.a; db.sessions.c = session('pc'); delete db.archivedLives; db.civic.v = 2; db.support = { reports: [1] }; delete db.civic; }), unavailable);
  await assert.rejects(store.transact((db) => { db.sessions = { only: session('po') }; }), unavailable);
  disk.fail = null;
  assert.deepEqual(await store.read((db) => JSON.parse(JSON.stringify(db))), before);
  assert.deepEqual(await store.read((db) => [db.$store.sessionKeyByPublicId('pa'), db.$store.sessionKeyByPublicId('pc'), db.$store.sessionKeyByPublicId('po')]), ['a', undefined, undefined]);
  await store.transact((db) => { db.sessions.b.name = 'after'; });
  assert.deepEqual(await file(), { ...before, sessions: { ...before.sessions, b: { ...before.sessions.b, name: 'after' } } });
});

test('a failed write: a read that saw the unsaved change is answered from what is stored; work running across the failure is rejected', async (t) => {
  const disk = flakyDisk();
  const { store } = await temp(t, { io: disk.io, log: () => {} });
  await store.transact((db) => { db.sessions.a = session('pa', { cash: 5000 }); });
  disk.fail = 'ENOSPC';
  const release = disk.hold();
  const debit = store.transact((db) => { db.sessions.a.cash -= 500; });
  // Applied in memory, write in flight: this read sees 4,500 but may not hand it out before it is saved.
  let reads = 0;
  const read = store.read((db) => { reads += 1; return db.sessions.a.cash; });
  // A lazy transaction that asks to wait for what it saw is rejected with the write it depended on.
  const poll = store.transact((db) => db.sessions.a.cash, { durable: false, waitForObserved: true });
  // An operation still running when the write fails read state that is about to vanish: it must change nothing.
  let finish;
  const slow = store.transact(async (db) => { const seen = db.sessions.a.cash; await new Promise((done) => { finish = done; }); db.sessions.a.cash = seen - 1; });
  await new Promise((done) => setTimeout(done, 10));
  release();
  await assert.rejects(debit, unavailable);
  await assert.rejects(poll, unavailable);
  finish();
  await assert.rejects(slow, unavailable);
  assert.equal(await read, 5000, 'the read ran again against the stored state');
  assert.equal(reads, 2);
  assert.equal(await store.read((db) => db.sessions.a.cash), 5000);
});

test('a write that fails at once: a read or transaction applied just before the undo is never answered as saved', async (t) => {
  // No hold on the disk here: the write is refused within a few microtasks, so the undo can run after a
  // queued read (or transaction) has looked at the unsaved change but before it asks whether that is on disk.
  const disk = flakyDisk();
  const { store } = await temp(t, { io: disk.io, log: () => {} });
  await store.transact((db) => { db.sessions.a = session('pa', { cash: 5000 }); });
  for (let round = 0; round < 25; round++) {
    disk.fail = 'ENOSPC';
    const debit = store.transact((db) => { db.sessions.a.cash -= 500; });
    const read = store.read((db) => db.sessions.a.cash);
    const second = store.transact((db) => { db.sessions.a.cash -= 1; return db.sessions.a.cash; });
    const poll = store.transact((db) => db.sessions.a.cash, { durable: false, waitForObserved: true });
    await assert.rejects(debit, unavailable);
    assert.equal(await read, 5000, 'never the 4,500 that was taken back');
    // Whatever order the queue ran them in, each either failed or acted on the stored 5,000.
    const [two, three] = await Promise.allSettled([second, poll]);
    if (two.status === 'fulfilled') assert.equal(two.value, 4999); else assert.ok(unavailable(two.reason));
    if (three.status === 'fulfilled') assert.ok([5000, 4999].includes(three.value)); else assert.ok(unavailable(three.reason));
    disk.fail = null;
    await store.transact((db) => { db.sessions.a.cash = 5000; });
    assert.equal((await store.read((db) => db.sessions.a.cash)), 5000);
  }
});

// From the navigation lane's store test of the same name (there it expects the raw ENOENT; here the caller gets
// storage_unavailable with that error as its cause).
test('grouped: a rejected durable write never commits or survives a later successful write', async (t) => {
  const { store, dir, file } = await temp(t, { log: () => {} });
  await store.transact((db) => { db.sessions.a = session('pa'); });
  const { mkdir } = await import('node:fs/promises');
  await rm(dir, { recursive: true, force: true }); // every write now fails
  const seen = [];
  await assert.rejects(store.transact((db) => { db.sessions.a.name = 'during the outage'; return 'value'; }, { committed: (value) => seen.push(value) }),
    (error) => unavailable(error) && error.cause?.code === 'ENOENT');
  assert.deepEqual(seen, [], 'a rejected durable transaction never calls committed');
  assert.equal(await store.read((db) => db.sessions.a.name), 'pa', 'a failed save leaves the last committed state readable');
  await mkdir(dir, { recursive: true });
  await store.transact((db) => { db.sessions.b = session('pb'); });
  const stored = await file();
  assert.deepEqual([stored.sessions.a.name, stored.sessions.b.publicId], ['pa', 'pb'], 'the rejected mutation never appears in a later successful file');
  // An aborted transaction never calls the listener.
  await assert.rejects(store.transact(() => { throw new Error('abort'); }, { committed: () => seen.push('no') }), /abort/);
  assert.deepEqual(seen, []);
});

test('a commit listener runs once the change is in the file, in order, before the caller resumes', async (t) => {
  const disk = flakyDisk();
  const { store, file } = await temp(t, { io: disk.io, lazyFlushMs: 30 });
  const order = [];
  const release = disk.hold();
  const one = store.transact((db) => { db.sessions.a = session('pa'); return 1; }, { committed: (value) => order.push(`hook ${value}`) }).then(() => order.push('resolved 1'));
  const two = store.transact((db) => { db.sessions.b = session('pb'); return 2; }, { committed: (value) => order.push(`hook ${value}`) }).then(() => order.push('resolved 2'));
  await new Promise((done) => setTimeout(done, 10));
  assert.deepEqual(order, [], 'applied in memory, not in the file: nobody has been told');
  release();
  await Promise.all([one, two]);
  assert.deepEqual(order.slice(0, 2), ['hook 1', 'resolved 1']); assert.ok(order.indexOf('hook 2') < order.indexOf('resolved 2'));
  // A lazy transaction resolves first; its listener still waits for the file.
  await store.transact((db) => { db.sessions.a.name = 'lazy'; return 3; }, { durable: false, committed: (value) => order.push(`hook ${value}`) });
  assert.equal(order.includes('hook 3'), false);
  await new Promise((done) => setTimeout(done, 100));
  assert.equal(order.at(-1), 'hook 3'); assert.equal((await file()).sessions.a.name, 'lazy');
  // An aborted transaction never calls it; one that changed nothing calls it at once.
  await assert.rejects(store.transact(() => { throw new Error('abort'); }, { committed: () => order.push('no') }), /abort/);
  await store.transact(() => 4, { committed: (value) => order.push(`hook ${value}`) });
  assert.equal(order.at(-1), 'hook 4'); assert.equal(order.includes('no'), false);
});

test('stored state cannot be changed through a value a transaction handed back', async (t) => {
  const { store, file } = await temp(t);
  const made = await store.transact((db) => { db.sessions.a = session('pa', { cities: { lagos: { state: { cash: 5000, ledger: [{ amount: 1 }] } } } }); db.civic = { cities: { lagos: { n: 1 } } }; return { record: db.sessions.a, civic: db.civic }; });
  assert.throws(() => { made.record.cities.lagos.state.cash = 9999999; }, TypeError);
  assert.throws(() => { made.record.cities.lagos.state.ledger.push({ amount: 5 }); }, TypeError);
  assert.throws(() => { made.civic.cities.lagos.n = 2; }, TypeError);
  assert.throws(() => { delete made.record.name; }, TypeError);
  const again = await store.transact((db) => db.sessions.a.cities.lagos.state);
  assert.throws(() => { again.cash = 1; }, TypeError);
  // Inside a transaction (and a read) the same record is a private, changeable copy; what a scan shows is not.
  await store.transact((db) => { db.$store.scanSessions((record) => { assert.throws(() => { record.name = 'x'; }, TypeError); return false; }); });
  await store.transact((db) => { db.sessions.a.cities.lagos.state.cash -= 100; });
  assert.equal(await store.read((db) => { db.sessions.a.cities.lagos.state.cash = 1; return db.sessions.a.cities.lagos.state.cash; }), 1);
  assert.equal((await file()).sessions.a.cities.lagos.state.cash, 4900);
  assert.equal((await file()).civic.cities.lagos.n, 1);
});

test('the write budget paces whole-file rewrites without delaying a lone write', async (t) => {
  const { store } = await temp(t, { writeMegabytesPerSecond: 0.001 }); // 1 byte per ms: a 2 kB file may be rewritten every ~2 s at most
  await store.transact((db) => { db.sessions.a = session('pa', { name: 'x'.repeat(100) }); });
  const started = Date.now(), before = store.stats().writes;
  await Promise.all(Array.from({ length: 20 }, (unused, i) => store.transact((db) => { db.sessions.a.name = `n${i}`; })));
  assert.equal(store.stats().writes - before, 1, 'twenty commits waited out the pause together and shared one write');
  assert.ok(Date.now() - started >= 100, 'the second write was held back by the budget');
});
