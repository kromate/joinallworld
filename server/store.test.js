import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './store.js';

async function temp(t, options) {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-store-'));
  const store = await createStore(dir, options);
  t.after(async () => { await store.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); });
  return { dir, store, file: async () => JSON.parse(await readFile(join(dir, 'devices.json'), 'utf8')) };
}
const session = (publicId, extra = {}) => ({ secret: `s-${publicId}`, publicId, name: publicId, expiresAt: 1000, cities: {}, actions: {}, ...extra });

for (const mode of ['grouped', 'legacy']) {
  test(`${mode}: a durable transaction is in the file when it resolves, and a throw changes nothing`, async (t) => {
    const { store, file } = await temp(t, { mode });
    await store.transact((db) => { db.sessions.a = session('pa'); db.social = { players: { pa: { name: 'Ada' } } }; });
    assert.deepEqual((await file()).sessions.a.publicId, 'pa');
    assert.equal((await file()).social.players.pa.name, 'Ada');
    await assert.rejects(store.transact((db) => { db.sessions.a.name = 'Changed'; db.sessions.b = session('pb'); db.social.players.pa.name = 'Changed'; delete db.sessions.a; throw new Error('abort'); }), /abort/);
    assert.deepEqual(await store.read((db) => [db.sessions.a.name, db.sessions.b, db.social.players.pa.name, Object.keys(db.sessions)]), ['pa', undefined, 'Ada', ['a']]);
    assert.equal((await file()).sessions.a.name, 'pa');
    assert.equal(store.stats().aborted, 1);
  });

  test(`${mode}: a read works on a copy and never writes`, async (t) => {
    const { store, file } = await temp(t, { mode });
    await store.transact((db) => { db.sessions.a = session('pa'); });
    const writes = store.stats().writes;
    const seen = await store.read((db) => { db.sessions.a.name = 'Mutated by a reader'; db.sessions.z = session('pz'); db.extra = { x: 1 }; return db.sessions.a.name; });
    assert.equal(seen, 'Mutated by a reader');
    assert.deepEqual(await store.read((db) => [db.sessions.a.name, db.sessions.z, db.extra, 'extra' in db]), ['pa', undefined, undefined, false]);
    assert.equal(store.stats().writes, writes);
    assert.equal((await file()).sessions.a.name, 'pa');
  });
}

test('grouped: the file is exactly the JSON of the document, whatever was touched', async (t) => {
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

test('grouped: the session map behaves like the plain object it replaces', async (t) => {
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

test('grouped: transactions committed while a write is in flight share the next write', async (t) => {
  const { store, file } = await temp(t);
  await store.transact((db) => { for (let i = 0; i < 50; i++) db.sessions[`k${i}`] = session(`p${i}`); });
  const before = store.stats().writes;
  await Promise.all(Array.from({ length: 50 }, (unused, i) => store.transact((db) => { db.sessions[`k${i}`].name = `renamed ${i}`; })));
  const used = store.stats().writes - before;
  assert.ok(used >= 1 && used <= 5, `50 concurrent transactions took ${used} writes`);
  const stored = await file();
  for (let i = 0; i < 50; i++) assert.equal(stored.sessions[`k${i}`].name, `renamed ${i}`);
});

test('grouped: a lazy transaction resolves before the disk and is written within the lazy interval; durable can be decided by the result', async (t) => {
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

test('grouped: close writes what is pending, and an unreadable file is refused at start', async (t) => {
  const { store, file, dir } = await temp(t, { lazyFlushMs: 60000 });
  await store.transact((db) => { db.sessions.a = session('pa'); }, { durable: false });
  await store.close();
  assert.equal((await file()).sessions.a.publicId, 'pa');
  await writeFile(join(dir, 'devices.json'), '{"version":2,"sessions":{}}');
  await assert.rejects(createStore(dir), /Invalid device database/);
});

test('grouped: the write budget paces whole-file rewrites without delaying a lone write', async (t) => {
  const { store } = await temp(t, { writeMegabytesPerSecond: 0.001 }); // 1 byte per ms: a 2 kB file may be rewritten every ~2 s at most
  await store.transact((db) => { db.sessions.a = session('pa', { name: 'x'.repeat(100) }); });
  const started = Date.now(), before = store.stats().writes;
  await Promise.all(Array.from({ length: 20 }, (unused, i) => store.transact((db) => { db.sessions.a.name = `n${i}`; })));
  assert.equal(store.stats().writes - before, 1, 'twenty commits waited out the pause together and shared one write');
  assert.ok(Date.now() - started >= 100, 'the second write was held back by the budget');
});
