// Fixed disposable SQL failure witnesses. Invoked only by index_resource_limits.py.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lstatSync } from 'node:fs';

const caseName = process.argv[2];
assert.ok(['commit', 'file-limit', 'heap-capability', 'page-limit', 'crash', 'wall-limit', 'cpu-limit', 'rss-limit', 'output-limit'].includes(caseName));
const root = tmpdir();
assert.match(path.basename(root), /^allworld-index-guard-/);
assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
const db = new DatabaseSync(path.join(root, 'witness.sqlite'));
const nativeHeapBytes = 8 * 1024 * 1024;
const actualNativeHeapBytes = db.prepare(`PRAGMA hard_heap_limit=${nativeHeapBytes}`).get().hard_heap_limit;
assert.ok(actualNativeHeapBytes > 0 && actualNativeHeapBytes <= nativeHeapBytes);
assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal');
db.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA wal_autocheckpoint=0;');
assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 2);
assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
db.exec('CREATE TABLE durable(id INTEGER PRIMARY KEY, payload BLOB NOT NULL); INSERT INTO durable VALUES(0,x\'01\');');
assert.equal(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy, 0);

if (caseName === 'crash') {
  db.exec('PRAGMA cache_size=4; PRAGMA cache_spill=ON; BEGIN IMMEDIATE; INSERT INTO durable VALUES(1,zeroblob(262144));');
  const uncommittedWalBytes = lstatSync(path.join(root, 'witness.sqlite-wal')).size;
  assert.ok(uncommittedWalBytes > 0, 'crash witness must spill real uncommitted WAL frames');
  console.log(JSON.stringify({ caseName, uncommittedWalBytes }));
  process.kill(process.pid, 'SIGKILL');
} else if (caseName === 'wall-limit') {
  await new Promise(resolve => setTimeout(resolve, 10_000));
} else if (caseName === 'cpu-limit') {
  // An intentionally finite loop, normally stopped by a one-second CPU limit.
  const end = performance.now() + 10_000;
  while (performance.now() < end) { Math.sqrt(performance.now()); }
} else if (caseName === 'output-limit') {
  process.stdout.write(Buffer.alloc(1_008_192, 0x78));
  await new Promise(resolve => setTimeout(resolve, 10_000));
} else if (caseName === 'rss-limit') {
  // Touch a bounded 96 MiB native allocation; the sampled 64 MiB test guard must stop it.
  const resident = Buffer.alloc(96 * 1024 * 1024, 0x11);
  await new Promise(resolve => setTimeout(resolve, 10_000));
  assert.equal(resident[resident.length - 1], 0x11);
} else if (caseName === 'heap-capability') {
  const compileOptions = db.prepare('PRAGMA compile_options').all().map(row => row.compile_options);
  let failure;
  let result;
  try { result = db.prepare('SELECT hex(zeroblob(4194304)) AS result').get().result; } catch (error) { failure = error; }
  // PRAGMA readback alone is not proof: DEFAULT_MEMSTATUS=0 disables enforcement.
  if (failure) assert.equal(failure.errcode, 7, 'unexpected SQLite allocation error');
  else assert.equal(result.length, 8 * 1024 * 1024);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM durable').get().n, 1);
  console.log(JSON.stringify({ caseName, nativeHeapBytes, actualNativeHeapBytes,
    nativeHeapEnforcedByWitness: failure?.errcode === 7,
    defaultMemoryAccountingDisabled: compileOptions.includes('DEFAULT_MEMSTATUS=0'),
    sqliteErrorCode: failure?.errcode ?? null, sqliteVersion: db.prepare('SELECT sqlite_version() AS v').get().v,
    returnedTextBytes: result?.length ?? 0 }));
} else {
  if (caseName === 'page-limit') {
    assert.equal(db.prepare('PRAGMA max_page_count=16').get().max_page_count, 16);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const insert = db.prepare('INSERT INTO durable VALUES(?,zeroblob(?))');
    const rows = caseName === 'commit' ? 4 : 128;
    for (let id = 1; id <= rows; id++) insert.run(id, 16384);
    db.exec('COMMIT');
    assert.equal(caseName, 'commit', 'a configured storage-failure witness must not commit');
    console.log(JSON.stringify({ caseName, committedRows: rows + 1, nativeHeapBytes }));
  } catch (error) {
    // SQLITE_FULL can auto-rollback. Roll back explicitly only if still active.
    try { db.exec('ROLLBACK'); } catch (rollback) {
      assert.match(rollback.message, /no transaction is active/);
    }
    if (caseName === 'page-limit') {
      assert.equal(error.errcode, 13, 'page limit must produce SQLITE_FULL');
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM durable').get().n, 1);
      console.log(JSON.stringify({ caseName, sqliteErrorCode: error.errcode, nativeHeapBytes }));
    } else {
      if (caseName === 'file-limit') {
        console.log(JSON.stringify({ caseName, sqliteErrorCode: error.errcode, code: error.code }));
      }
      throw error;
    }
  }
}
db.close();
