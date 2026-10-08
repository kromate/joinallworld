import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireFineSource } from './fine-acquire.ts';
import type { FineSourcePin } from './fine-types.ts';

function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function pinFor(bytes: Buffer): FineSourcePin {
  const release = '9469f09592ced973a3448cf66b6100b741b64c0d', countryIso3 = 'RWA';
  const sha = hash(bytes);
  return {
    schemaVersion: 1, provider: 'geoBoundaries', source: {
      id: `geoBoundaries-${release}-${countryIso3}-ADM1`,
      url: `https://raw.githubusercontent.com/wmgeolab/geoBoundaries/${release}/releaseData/gbOpen/${countryIso3}/ADM1/geoBoundaries-${countryIso3}-ADM1.geojson`,
      release, license: 'CC BY 4.0', attribution: 'geoBoundaries', sha256: sha, bytes: bytes.length,
    },
    input: `.cache/world-build/fine-source-cache/${sha}.geojson`, countryCode: 'RW', countryIso3,
    adminLevel: 'ADM1', layerId: 'RWA-ADM1-fixture', canonicalType: 'Province', representedYear: '2020', buildDate: 'Dec 12, 2023',
    expectedUnits: 5, originalLicense: 'CC BY 4.0', licenseEvidence: ['fixture evidence'],
    metadataSha256: 'b'.repeat(64), metadataBytes: 128, boundaryPolicy: 'Administrative source boundaries',
  };
}
async function fixture<T>(run: (ctx: { root: string; bytes: Buffer; pin: FineSourcePin; cache: string; attempts: string }) => Promise<T>, bytes = Buffer.from('{"type":"FeatureCollection","features":[]}')) {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'fine-acquire-'));
  const cache = path.join(root, '.cache', 'world-build', 'fine-source-cache');
  const attempts = path.join(cache, 'attempts');
  await mkdir(cache, { recursive: true });
  try { return await run({ root, bytes, pin: pinFor(bytes), cache, attempts }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
function response(bytes: Buffer, status = 200, contentLength = String(bytes.length)): Response {
  const body = new Uint8Array(bytes.byteLength);
  body.set(bytes);
  return new Response(body, { status, headers: { 'content-length': contentLength } });
}
async function auditRecords(directory: string): Promise<Array<Record<string, unknown>>> {
  const source = await readFile(path.join(directory, 'attempts.jsonl'), 'utf8');
  return source.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
}

test('downloads only the reviewed exact URL, pins bytes and reuses a verified cache without network', async () => fixture(async ({ root, bytes, pin, cache }) => {
  let calls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), pin.source.url);
    assert.equal(init?.redirect, 'manual');
    assert.equal(new Headers(init?.headers).get('accept-encoding'), 'identity');
    return response(bytes);
  };
  const first = await acquireFineSource(pin, { repositoryRoot: root, fetcher });
  assert.deepEqual({ networkBytes: first.networkBytes, sourceBytes: first.sourceBytes, cacheHit: first.cacheHit }, { networkBytes: bytes.length, sourceBytes: bytes.length, cacheHit: false });
  assert.equal(hash(await readFile(first.inputPath)), pin.source.sha256);
  const receipt = JSON.parse(await readFile(first.receiptPath, 'utf8')) as Record<string, unknown>;
  assert.equal(receipt.observedHttpStatus, 200);
  const cached = await acquireFineSource(pin, { repositoryRoot: root, fetcher: async () => { throw new Error('cache hit attempted network'); } });
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.networkBytes, 0);
  assert.equal(calls, 1);
  assert.equal((await auditRecords(path.join(cache, 'attempts'))).filter(record => record.status === 'success').length, 1);
}));

test('rejects redirects with zero retries and retains measured error-body bytes for audit', async () => fixture(async ({ root, pin, attempts }) => {
  const errorBody = Buffer.from('redirect');
  let calls = 0;
  await assert.rejects(acquireFineSource(pin, { repositoryRoot: root, fetcher: async () => { calls++; return response(errorBody, 302); } }), /redirect status 302/);
  assert.equal(calls, 1);
  const records = await auditRecords(attempts);
  assert.equal(records[0]!.networkReservationUpperBoundBytes, 8 * 1024 * 1024);
  assert.equal(records[1]!.networkBytesMeasured, errorBody.length);
  assert.equal(records[1]!.status, 'failure');
  const partial = records[1]!.partialPath as string;
  assert.equal(await readFile(partial, 'utf8'), errorBody.toString());
}));

test('cache-only verification of missing bytes neither contacts a source nor spends a reservation', async () => fixture(async ({ root, pin, attempts }) => {
  let calls = 0;
  await assert.rejects(acquireFineSource(pin, { repositoryRoot: root, cacheOnly: true, fetcher: async () => { calls++; return response(Buffer.from('ignored')); } }), /cache-only/);
  assert.equal(calls, 0);
  await assert.rejects(readFile(path.join(attempts, 'attempts.jsonl')), { code: 'ENOENT' });
}));

test('rejects a source hash mismatch and retains the complete partial response', async () => fixture(async ({ root, pin, attempts }) => {
  const wrong = Buffer.from('same-sized? nope');
  await assert.rejects(acquireFineSource(pin, { repositoryRoot: root, fetcher: async () => response(wrong) }), /hash or byte count/);
  const records = await auditRecords(attempts), terminal = records.at(-1)!;
  assert.equal(terminal.networkBytesMeasured, wrong.length);
  assert.equal(await readFile(terminal.partialPath as string, 'utf8'), wrong.toString());
  await assert.rejects(readFile(path.join(path.dirname(terminal.partialPath as string), `${pin.source.sha256}.geojson`)));
}));

test('rejects a terminal audit that releases bytes from an incomplete transfer', async () => fixture(async ({ root, pin, attempts }) => {
  await mkdir(attempts, { recursive: true });
  const common = { schemaVersion: 1, attemptId: 'interrupted', sourceSha256: pin.source.sha256 };
  const records = [
    { ...common, event: 'started', networkReservationUpperBoundBytes: 8 * 1024 * 1024 },
    { ...common, event: 'finished', responseComplete: false, networkReservationUpperBoundBytes: 10, networkBytesMeasured: 10 },
  ];
  const original = records.map(record => JSON.stringify(record)).join('\n') + '\n';
  await writeFile(path.join(attempts, 'attempts.jsonl'), original);
  let calls = 0;
  await assert.rejects(acquireFineSource(pin, { repositoryRoot: root, fetcher: async () => { calls++; return response(Buffer.from('ignored')); } }), /unmeasured reservation/);
  assert.equal(calls, 0);
  assert.equal(await readFile(path.join(attempts, 'attempts.jsonl'), 'utf8'), original);
}));

test('aborts a stalled request at the whole-operation deadline and records an unknown-byte reservation', async () => fixture(async ({ root, pin, attempts }) => {
  await assert.rejects(acquireFineSource(pin, { repositoryRoot: root, durationMs: 1_000, fetcher: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')), { once: true });
  }) }), /deadline|timed out|abort/i);
  const records = await auditRecords(attempts), terminal = records.at(-1)!;
  assert.equal(terminal.networkBytesMeasured, null);
  assert.equal(terminal.networkReservationUpperBoundBytes, 8 * 1024 * 1024);
}));

test('fails closed on a corrupted existing content-addressed source without redownloading or replacing it', async () => fixture(async ({ root, pin, cache }) => {
  const inputPath = path.join(cache, `${pin.source.sha256}.geojson`), corrupt = Buffer.from('tampered retained data');
  await writeFile(inputPath, corrupt);
  let calls = 0;
  await assert.rejects(acquireFineSource(pin, { repositoryRoot: root, fetcher: async () => { calls++; return response(Buffer.from('ignored')); } }), /hash\/byte mismatch/);
  assert.equal(calls, 0);
  assert.deepEqual(await readFile(inputPath), corrupt);
}));

test('rejects an over-cap response body and retains no more than the 8 MiB body allowance', async () => fixture(async ({ root, pin, attempts }) => {
  const overLimit = new Uint8Array(8 * 1024 * 1024 + 1).fill(0x41);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(overLimit); controller.close(); } });
  const tooLarge = new Response(stream, { status: 200, headers: { 'content-length': String(overLimit.length) } });
  await assert.rejects(acquireFineSource(pin, { repositoryRoot: root, fetcher: async () => tooLarge }), /remaining per-source network budget/);
  const terminal = (await auditRecords(attempts)).at(-1)!;
  assert.equal(terminal.networkBytesMeasured, 8 * 1024 * 1024 + 1);
  assert.equal(terminal.networkReservationUpperBoundBytes, 8 * 1024 * 1024);
  assert.equal(terminal.responseComplete, false);
  assert.equal((await readFile(terminal.partialPath as string)).length, 8 * 1024 * 1024);
}));

test('refuses symlink ancestors and preserves external target without writing through it', async () => {
  const parent = await mkdtemp(path.join(await realpath(os.tmpdir()), 'fine-acquire-link-'));
  const real = path.join(parent, 'real'), outside = path.join(parent, 'outside');
  await mkdir(real); await mkdir(outside); await symlink(outside, path.join(real, '.cache'));
  try {
    await assert.rejects(acquireFineSource(pinFor(Buffer.from('x')), { repositoryRoot: real, fetcher: async () => response(Buffer.from('x')) }), /symlink/);
    assert.deepEqual(await readdir(outside), []);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('enforces the attempt audit entry cap before making a request', async () => fixture(async ({ root, pin, attempts }) => {
  await mkdir(attempts, { recursive: true });
  const records: Array<Record<string, unknown>> = [];
  for (let index = 0; index < 256; index++) {
    const attemptId = `fixture-${index}`, sourceSha256 = index.toString(16).padStart(64, '0');
    records.push({ schemaVersion: 1, attemptId, event: 'started', sourceSha256, networkReservationUpperBoundBytes: 1 });
    records.push({ schemaVersion: 1, attemptId, event: 'finished', sourceSha256, responseComplete: true, networkReservationUpperBoundBytes: 1, networkBytesMeasured: 1 });
  }
  const lines = records.map(record => JSON.stringify(record)).join('\n') + '\n';
  await writeFile(path.join(attempts, 'attempts.jsonl'), lines);
  let calls = 0;
  await assert.rejects(acquireFineSource(pin, { repositoryRoot: root, fetcher: async () => { calls++; return response(Buffer.from('x')); } }), /512-entry/);
  assert.equal(calls, 0);
  assert.equal((await readFile(path.join(attempts, 'attempts.jsonl'), 'utf8')), lines);
}));

test('an interrupted body reserves the full remaining allowance and prevents a second fetch for the same source hash', async () => fixture(async ({ root, bytes, pin, attempts }) => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes.subarray(0, 8)));
        setTimeout(() => controller.error(new Error('connection interrupted')), 10);
      },
    });
    return new Response(body, { status: 200 });
  };
  await assert.rejects(acquireFineSource(pin, { repositoryRoot: root, fetcher }), /connection interrupted/);
  const terminal = (await auditRecords(attempts)).at(-1)!;
  assert.equal(terminal.networkBytesMeasured, 8);
  assert.equal(terminal.responseComplete, false);
  assert.equal(terminal.networkReservationUpperBoundBytes, 8 * 1024 * 1024);
  await assert.rejects(acquireFineSource({ ...pin, licenseEvidence: ['changed pin metadata'] }, { repositoryRoot: root, fetcher }), /cumulative 8 MiB network budget/);
  assert.equal(calls, 1);
}));

test('stale starts reserve source-hash quota while a verified cache hit still succeeds at exhausted quota', async () => fixture(async ({ root, bytes, pin, cache, attempts }) => {
  const first = await acquireFineSource(pin, { repositoryRoot: root, fetcher: async () => response(bytes) });
  await appendFile(path.join(attempts, 'attempts.jsonl'), `${JSON.stringify({ schemaVersion: 1, attemptId: 'interrupted-before-terminal', event: 'started', sourceSha256: pin.source.sha256, networkReservationUpperBoundBytes: 8 * 1024 * 1024 })}\n`);
  const cached = await acquireFineSource(pin, { repositoryRoot: root, fetcher: async () => { throw new Error('cache hit attempted network'); } });
  assert.equal(cached.cacheHit, true);
  await unlink(first.inputPath);
  await unlink(first.receiptPath);
  let calls = 0;
  await assert.rejects(acquireFineSource(pin, { repositoryRoot: root, fetcher: async () => { calls++; return response(bytes); } }), /cumulative 8 MiB network budget/);
  assert.equal(calls, 0);
  assert.equal((await readdir(cache)).some(name => name.endsWith('.partial')), false);
}));

test('admits an attempt with exactly two audit entries remaining and persists its terminal record', async () => fixture(async ({ root, bytes, pin, attempts }) => {
  await mkdir(attempts, { recursive: true });
  const records: Array<Record<string, unknown>> = [];
  for (let index = 0; index < 255; index++) {
    const attemptId = `prior-${index}`, sourceSha256 = (index + 1).toString(16).padStart(64, '0');
    records.push({ schemaVersion: 1, attemptId, event: 'started', sourceSha256, networkReservationUpperBoundBytes: 1 });
    records.push({ schemaVersion: 1, attemptId, event: 'finished', sourceSha256, responseComplete: true, networkReservationUpperBoundBytes: 1, networkBytesMeasured: 1 });
  }
  await writeFile(path.join(attempts, 'attempts.jsonl'), `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
  const result = await acquireFineSource(pin, { repositoryRoot: root, fetcher: async () => response(bytes) });
  assert.equal(result.cacheHit, false);
  assert.equal((await auditRecords(attempts)).length, 512);
}));
