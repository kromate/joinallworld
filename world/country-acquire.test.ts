import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { acquireCountrySource, validateCountryCaptureSpec } from './country-acquire.ts';
import type { CountryCaptureSpec } from './country-types.ts';

const release = 'a'.repeat(40);
const metadataPath = '.cache/world-build/evidence/country-resolution-research/ne-10m-countries-api.json';
const artifactPath = 'geojson/ne_10m_admin_0_countries.geojson';
const rawUrl = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/${artifactPath}`;
const blobUrl = (sha: string) => `https://api.github.com/repos/nvkelso/natural-earth-vector/git/blobs/${sha}`;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const blobSha1 = (bytes: Uint8Array) => createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
const requestHash = (spec: CountryCaptureSpec) => sha256(JSON.stringify({ blob: spec.expectedGitBlobSha1, expectedBytes: spec.expectedBytes, path: artifactPath, release: spec.release }));

function specFor(raw: Buffer, blob = blobSha1(raw)): CountryCaptureSpec {
  const metadata = Buffer.from(JSON.stringify({ name: 'ne_10m_admin_0_countries.geojson', path: artifactPath, sha: blob, size: raw.length,
    url: `https://api.github.com/repos/nvkelso/natural-earth-vector/contents/${artifactPath}?ref=${release}`,
    html_url: `https://github.com/nvkelso/natural-earth-vector/blob/${release}/${artifactPath}`,
    git_url: blobUrl(blob), download_url: rawUrl, type: 'file', content: '', encoding: 'none',
    _links: { self: 'https://api.github.com/example', git: blobUrl(blob), html: 'https://github.com/example' } }));
  return { schemaVersion: 1, provider: 'natural-earth', release, resolution: '10m', metadataPath,
    metadataSha256: sha256(metadata), metadataBytes: metadata.length, expectedBytes: raw.length, expectedGitBlobSha1: blob,
    license: 'Public-domain', attribution: 'SYNTHETIC FIXTURE ONLY; not real Natural Earth data' };
}
async function fixture<T>(run: (context: { root: string; raw: Buffer; spec: CountryCaptureSpec; metadata: Buffer }) => Promise<T>, raw = Buffer.from('{"type":"FeatureCollection","features":[]}')) {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'country-acquire-'));
  const metadataFile = path.join(root, metadataPath), metadataDirectory = path.dirname(metadataFile);
  await mkdir(metadataDirectory, { recursive: true });
  const spec = specFor(raw);
  const metadata = Buffer.from(JSON.stringify({ name: 'ne_10m_admin_0_countries.geojson', path: artifactPath, sha: spec.expectedGitBlobSha1, size: raw.length,
    url: `https://api.github.com/repos/nvkelso/natural-earth-vector/contents/${artifactPath}?ref=${release}`,
    html_url: `https://github.com/nvkelso/natural-earth-vector/blob/${release}/${artifactPath}`,
    git_url: blobUrl(spec.expectedGitBlobSha1), download_url: rawUrl, type: 'file', content: '', encoding: 'none',
    _links: { self: 'https://api.github.com/example', git: blobUrl(spec.expectedGitBlobSha1), html: 'https://github.com/example' } }));
  spec.metadataSha256 = sha256(metadata); spec.metadataBytes = metadata.length;
  await writeFile(metadataFile, metadata, { mode: 0o600 });
  try { return await run({ root, raw, spec, metadata }); }
  finally { await rm(root, { recursive: true, force: true }); }
}
function response(raw: Buffer, status = 200, encoding?: string): Response {
  const chunks = [raw.subarray(0, Math.min(3, raw.length)), raw.subarray(Math.min(3, raw.length))].filter(chunk => chunk.length);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk)); controller.close(); } });
  return new Response(stream, { status, headers: encoding ? { 'content-encoding': encoding } : {} });
}
async function records(root: string, requestHash: string): Promise<Array<Record<string, unknown>>> {
  const filename = path.join(root, '.cache/world-build/country-source-cache/attempts', requestHash, 'attempts.jsonl');
  return (await readFile(filename, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
}

test('validates exact Natural Earth capture scope, immutable release and local metadata pin shape', async () => fixture(async ({ spec }) => {
  assert.deepEqual(validateCountryCaptureSpec(spec), spec);
  for (const bad of [
    { ...spec, release: 'short' }, { ...spec, resolution: '50m' }, { ...spec, metadataPath: '../elsewhere.json' },
    { ...spec, expectedBytes: 16 * 1024 * 1024 + 1 }, { ...spec, provider: 'other' },
  ]) assert.throws(() => validateCountryCaptureSpec(bad));
}));

test('captures a synthetic pinned fixture, verifies Git blob and SHA-256, then reuses cache with zero network', async () => fixture(async ({ root, raw, spec }) => {
  let calls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), rawUrl);
    assert.equal(init?.redirect, 'manual');
    assert.equal(new Headers(init?.headers).get('accept-encoding'), 'identity');
    return response(raw);
  };
  const first = await acquireCountrySource(spec, { repositoryRoot: root, fetcher });
  assert.equal(first.networkBytes, raw.length);
  assert.equal(first.source.sha256, sha256(raw));
  assert.equal(first.source.bytes, raw.length);
  assert.equal(first.source.id, `natural-earth-admin0-10m-${release}`);
  assert.equal(first.input, `.cache/world-build/country-source-cache/${first.requestHash}.geojson`);
  assert.deepEqual(await readFile(first.inputPath), raw);
  const receipt = JSON.parse(await readFile(first.receiptPath, 'utf8')) as Record<string, unknown>;
  assert.equal(receipt.gitBlobSha1, blobSha1(raw));
  assert.equal(receipt.evidence, 'exact-pinned-response-hash-verified');
  const cached = await acquireCountrySource({ ...spec, attribution: 'Updated descriptive attribution' }, { repositoryRoot: root, fetcher: async () => { throw new Error('cache hit contacted network'); } });
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.networkBytes, 0);
  assert.equal(cached.requestHash, first.requestHash);
  assert.equal(calls, 1);
}));

test('rejects metadata substitution, wrong URL/blob/size/encoding and tampered metadata bytes before fetch', async () => fixture(async ({ root, spec, metadata }) => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error('metadata mismatch must precede network'); };
  const filename = path.join(root, metadataPath);
  const variants = [
    { path: 'geojson/other.geojson' }, { download_url: 'https://example.com/evil.geojson' },
    { sha: '0'.repeat(40) }, { size: 999 }, { encoding: 'base64' },
  ];
  for (const mutation of variants) {
    const current = JSON.parse(metadata.toString('utf8')) as Record<string, unknown>;
    const changed = Buffer.from(JSON.stringify({ ...current, ...mutation }));
    await writeFile(filename, changed);
    const changedSpec = { ...spec, metadataSha256: sha256(changed), metadataBytes: changed.length };
    await assert.rejects(acquireCountrySource(changedSpec, { repositoryRoot: root, fetcher }), /exact pinned artifact/);
  }
  await writeFile(filename, metadata);
  const tampered = Buffer.from(metadata); tampered[0] = tampered[0]! ^ 1; await writeFile(filename, tampered);
  await assert.rejects(acquireCountrySource(spec, { repositoryRoot: root, fetcher }), /metadata bytes do not match/);
  assert.equal(calls, 0);
}));

test('redirect bodies are measured and retained; content encoding fails closed with a full reservation', async () => fixture(async ({ root, spec }) => {
  await assert.rejects(acquireCountrySource(spec, { repositoryRoot: root, fetcher: async () => response(Buffer.from('redirect body'), 302) }), /redirected with HTTP 302/);
  const firstRecords = await records(root, requestHash(spec)), first = firstRecords.at(-1)!;
  assert.equal(first.networkBytesMeasured, 13);
  assert.equal(first.responseComplete, true);
  assert.equal(await readFile(first.partialPath as string, 'utf8'), 'redirect body');

  await fixture(async ({ root: encodingRoot, raw: encodingRaw, spec: encodingSpec }) => {
    await assert.rejects(acquireCountrySource(encodingSpec, { repositoryRoot: encodingRoot, fetcher: async () => response(encodingRaw, 200, 'gzip') }), /ignored identity-encoding/);
    const id = requestHash(encodingSpec);
    const record = (await records(encodingRoot, id)).at(-1)!;
    assert.equal(record.networkBytesMeasured, null);
    assert.equal(record.networkReservationUpperBoundBytes, 16 * 1024 * 1024);
  });
}));

test('a complete wrong blob is retained as failed evidence and consumes measured bytes', async () => fixture(async ({ root, raw, spec }) => {
  const wrongBlob = 'f'.repeat(40), metadataRaw = JSON.parse((await readFile(path.join(root, metadataPath))).toString('utf8')) as Record<string, unknown>;
  const metadata = Buffer.from(JSON.stringify({ ...metadataRaw, sha: wrongBlob, git_url: blobUrl(wrongBlob), _links: { ...metadataRaw._links as object, git: blobUrl(wrongBlob) } }));
  await writeFile(path.join(root, metadataPath), metadata);
  const wrongSpec = { ...spec, expectedGitBlobSha1: wrongBlob, metadataSha256: sha256(metadata), metadataBytes: metadata.length };
  await assert.rejects(acquireCountrySource(wrongSpec, { repositoryRoot: root, fetcher: async () => response(raw) }), /Git blob SHA-1 differs/);
  const requestHashWrong = sha256(JSON.stringify({ blob: wrongBlob, expectedBytes: spec.expectedBytes, path: artifactPath, release: spec.release }));
  const terminal = (await records(root, requestHashWrong)).at(-1)!;
  assert.equal(terminal.status, 'failure');
  assert.equal(terminal.responseComplete, true);
  assert.equal(terminal.networkBytesMeasured, raw.length);
  assert.equal(terminal.networkReservationUpperBoundBytes, raw.length);
  assert.equal(await readFile(terminal.partialPath as string).then(bytes => bytes.length), raw.length);
  await assert.rejects(readFile(path.join(root, '.cache/world-build/country-source-cache', `${requestHashWrong}.geojson`)), { code: 'ENOENT' });
}));

test('interrupted transfer retains full reservation; valid cached source remains usable after exhausted audit', async () => fixture(async ({ root, raw, spec }) => {
  const fetcher: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(raw.subarray(0, 4))); setTimeout(() => controller.error(new Error('synthetic interrupted stream')), 5);
  } }), { status: 200 });
  await assert.rejects(acquireCountrySource(spec, { repositoryRoot: root, fetcher }), /synthetic interrupted stream/);
  const terminal = (await records(root, requestHash(spec))).at(-1)!;
  assert.equal(terminal.networkBytesMeasured, 4);
  assert.equal(terminal.responseComplete, false);
  assert.equal(terminal.networkReservationUpperBoundBytes, 16 * 1024 * 1024);
  let calls = 0;
  await assert.rejects(acquireCountrySource(spec, { repositoryRoot: root, fetcher: async () => { calls++; throw new Error('reservation should block'); } }), /allowance (?:is exhausted|cannot cover)/);
  assert.equal(calls, 0);

  // Seed a success via the same synthetic pin in a separate fixture, then show cache hits bypass exhausted network quota.
  await fixture(async ({ root: successRoot, raw: successRaw, spec: successSpec }) => {
    const success = await acquireCountrySource(successSpec, { repositoryRoot: successRoot, fetcher: async () => response(successRaw) });
    const auditFile = path.join(successRoot, '.cache/world-build/country-source-cache/attempts', success.requestHash, 'attempts.jsonl');
    await appendFile(auditFile, `${JSON.stringify({ schemaVersion: 1, attemptId: '11111111-1111-4111-8111-111111111111', requestHash: success.requestHash,
      event: 'started', status: 'pending', networkReservationUpperBoundBytes: 16 * 1024 * 1024 })}\n`);
    const cached = await acquireCountrySource(successSpec, { repositoryRoot: successRoot, fetcher: async () => { throw new Error('cached bytes must avoid network'); } });
    assert.equal(cached.cacheHit, true); assert.equal(cached.networkBytes, 0);
  });
}));

test('cache corruption is retained, cache-only misses do not reserve, and symlinked roots are refused', async () => fixture(async ({ root, raw, spec }) => {
  await assert.rejects(acquireCountrySource(spec, { repositoryRoot: root, cacheOnly: true }), /cache-only/);
  assert.equal(await readdir(path.join(root, '.cache/world-build')).then(names => names.includes('country-source-cache')), false);
  const first = await acquireCountrySource(spec, { repositoryRoot: root, fetcher: async () => response(raw) });
  const bytes = await readFile(first.inputPath); bytes[0] = bytes[0]! ^ 1; await writeFile(first.inputPath, bytes);
  let calls = 0;
  await assert.rejects(acquireCountrySource(spec, { repositoryRoot: root, fetcher: async () => { calls++; return response(raw); } }), /Git blob SHA mismatch/);
  assert.equal(calls, 0);

  const parent = await mkdtemp(path.join(await realpath(os.tmpdir()), 'country-acquire-link-'));
  try {
    const real = path.join(parent, 'real'), outside = path.join(parent, 'outside'); await mkdir(real); await mkdir(outside);
    await symlink(outside, path.join(real, '.cache'));
    await assert.rejects(acquireCountrySource(spec, { repositoryRoot: real, fetcher: async () => response(raw) }), /symlink/);
    assert.deepEqual(await readdir(outside), []);
  } finally { await rm(parent, { recursive: true, force: true }); }
}));

test('missing-receipt restore revalidates Git blob, records explicit cache provenance, and stays network-free', async () => fixture(async ({ root, raw, spec }) => {
  const first = await acquireCountrySource(spec, { repositoryRoot: root, fetcher: async () => response(raw) });
  await unlink(first.receiptPath);
  const restored = await acquireCountrySource(spec, { repositoryRoot: root, cacheOnly: true, fetcher: async () => { throw new Error('cache restore must not fetch'); } });
  assert.equal(restored.cacheHit, true);
  const receipt = JSON.parse(await readFile(restored.receiptPath, 'utf8')) as Record<string, unknown>;
  assert.equal(receipt.evidence, 'verified-existing-git-blob-cache');
  assert.equal(receipt.observedHttpStatus, null);
  assert.equal(receipt.upstreamBytes, 0);
}));

test('over-budget chunk is counted whole while only remaining allowance is retained', async () => fixture(async ({ root, spec }) => {
  const body = new Uint8Array(16 * 1024 * 1024 + 1).fill(0x78);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(body); controller.close(); } });
  await assert.rejects(acquireCountrySource(spec, { repositoryRoot: root, fetcher: async () => new Response(stream, { status: 200 }) }), /exceeds its 16 MiB cumulative/);
  const terminal = (await records(root, requestHash(spec))).at(-1)!;
  assert.equal(terminal.responseComplete, false);
  assert.equal(terminal.networkBytesMeasured, body.length);
  assert.equal(terminal.networkReservationUpperBoundBytes, body.length - 1);
  assert.equal((await readFile(terminal.partialPath as string)).length, body.length - 1);
}));

test('corrupt retained audit blocks even an otherwise valid cache hit', async () => fixture(async ({ root, raw, spec }) => {
  const captured = await acquireCountrySource(spec, { repositoryRoot: root, fetcher: async () => response(raw) });
  const audit = path.join(root, '.cache/world-build/country-source-cache/attempts', captured.requestHash, 'attempts.jsonl');
  await appendFile(audit, '{not-json}\n');
  await assert.rejects(acquireCountrySource(spec, { repositoryRoot: root, fetcher: async () => { throw new Error('audit failure must precede any fetch'); } }), /audit JSONL is malformed/);
}));
