import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { acquireSettlementSource, validateSettlementCaptureSpec } from './settlement-acquire.ts';
import { SETTLEMENT_CAPTURE_LIMITS, type SettlementCaptureSpec } from './settlement-types.ts';

const release = 'a'.repeat(40);
const artifact = 'geojson/ne_10m_populated_places.geojson';
const metadataPath = '.cache/world-build/evidence/settlement-admission/source-api.json';
const rawUrl = (rev: string) => `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${rev}/${artifact}`;
const api = 'https://api.github.com/repos/nvkelso/natural-earth-vector';
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const blob = (bytes: Uint8Array) => createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') { const row = value as Record<string, unknown>; return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`; }
  throw new TypeError('test value is not JSON');
}

async function setup(run: (root: string, raw: Buffer, spec: SettlementCaptureSpec) => Promise<void>, raw = Buffer.from('synthetic settlement capture fixture')): Promise<void> {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'settlement-acquire-'));
  try {
    const spec = await writeMetadata(root, raw);
    await run(root, raw, spec);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function writeMetadata(root: string, raw: Buffer, revision = release): Promise<SettlementCaptureSpec> {
  const digest = blob(raw), url = rawUrl(revision), git = `${api}/git/blobs/${digest}`;
  const contentUrl = `${api}/contents/${artifact}?ref=${revision}`;
  const html = `https://github.com/nvkelso/natural-earth-vector/blob/${revision}/${artifact}`;
  const body = Buffer.from(JSON.stringify({ name: path.basename(artifact), path: artifact, sha: digest, size: raw.length,
    url: contentUrl, html_url: html, git_url: git, download_url: url, type: 'file', content: '', encoding: 'none',
    _links: { self: contentUrl, git, html } }));
  const file = path.join(root, metadataPath);
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, body, { mode: 0o600 });
  return { schemaVersion: 1, provider: 'natural-earth', release: revision, resolution: '10m', metadataPath,
    metadataSha256: sha(body), metadataBytes: body.length, expectedBytes: raw.length, expectedGitBlobSha1: digest,
    license: 'Public-domain', attribution: 'SYNTHETIC FIXTURE ONLY' };
}
function response(raw: Buffer, status = 200, headers: Record<string, string> = {}, url = rawUrl(release)): Response {
  const result = new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array(raw)); controller.close();
  } }), { status, headers: { 'content-type': 'application/geo+json', 'content-length': String(raw.length), ...headers } });
  Object.defineProperty(result, 'url', { value: url }); return result;
}
const cacheRoot = (root: string) => path.join(root, '.cache/world-build/settlement-source-cache');
async function rows(root: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(path.join(cacheRoot(root), 'network-audit.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
}

test('validates fixed Natural Earth settlement artifact scope', async () => setup(async (_root, _raw, spec) => {
  assert.deepEqual(validateSettlementCaptureSpec(spec), spec);
  assert.throws(() => validateSettlementCaptureSpec({ ...spec, release: 'abcd' }));
  assert.throws(() => validateSettlementCaptureSpec({ ...spec, metadataPath: '../outside' }));
  assert.throws(() => validateSettlementCaptureSpec({ ...spec, expectedBytes: SETTLEMENT_CAPTURE_LIMITS.sourceBytes + 1 }));
  assert.throws(() => validateSettlementCaptureSpec({ ...spec, expectedGitBlobSha1: 'A'.repeat(40) }));
}));

test('captures exact synthetic stream and reuses verified cache without network', async () => setup(async (root, raw, spec) => {
  let calls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    calls++; assert.equal(String(input), rawUrl(release)); assert.equal(init?.redirect, 'manual');
    assert.equal(new Headers(init?.headers).get('accept-encoding'), 'identity'); return response(raw);
  };
  const first = await acquireSettlementSource(spec, { repositoryRoot: root, fetcher });
  assert.equal(first.networkBytes, raw.length); assert.equal(first.source.sha256, sha(raw));
  assert.equal(first.source.bytes, raw.length); assert.equal(first.source.id, `natural-earth-places-10m-${release}`);
  assert.deepEqual(await readFile(first.inputPath), raw);
  const receipt = JSON.parse(await readFile(first.receiptPath, 'utf8')) as Record<string, unknown>;
  assert.equal(receipt.gitBlobSha1, blob(raw)); assert.equal(receipt.evidence, 'exact-pinned-response-hash-verified');
  const hit = await acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => { throw new Error('cache hit used network'); } });
  assert.equal(hit.cacheHit, true); assert.equal(hit.networkBytes, 0); assert.equal(hit.requestHash, first.requestHash); assert.equal(calls, 1);
  const audit = await rows(root); assert.equal(audit.filter(row => row.event === 'started').length, 1);
}));

test('GitHub octet-stream transport still requires exact pinned bytes and blob', async () => setup(async (root, raw, spec) => {
  const first = await acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => response(raw, 200, { 'content-type': 'application/octet-stream' }) });
  assert.equal(first.source.sha256, sha(raw));
  assert.equal(first.networkBytes, raw.length);
}));

test('metadata tampering fails before any request', async () => setup(async (root, raw, spec) => {
  const file = path.join(root, metadataPath), saved = await readFile(file);
  await writeFile(file, Buffer.from(saved.toString().replace(spec.expectedGitBlobSha1, '0'.repeat(40))));
  let calls = 0;
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => { calls++; return response(raw); } }), /metadata does not match/);
  assert.equal(calls, 0);
}));

for (const [name, responseFor, expected] of [
  ['redirect status', (raw: Buffer) => response(raw, 302), /HTTP 302/],
  ['compressed response', (raw: Buffer) => response(raw, 200, { 'content-encoding': 'gzip' }), /identity encoded/],
  ['HTML response', (raw: Buffer) => response(raw, 200, { 'content-type': 'text/html' }), /content type/],
  ['wrong content length', (raw: Buffer) => response(raw, 200, { 'content-length': String(raw.length + 1) }), /Content-Length/],
  ['redirected response URL', (raw: Buffer) => response(raw, 200, {}, `${rawUrl(release)}?redirected=1`), /response URL/],
] as const) {
  test(`rejects ${name} with conservative attempt evidence`, async () => setup(async (root, raw, spec) => {
    await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => responseFor(raw) }), expected);
    const audit = await rows(root); const finish = audit.find(row => row.event === 'finished')!;
    assert.equal(finish.complete, false); assert.equal(finish.networkBytesMeasured, null);
    assert.equal(finish.reservedNetworkBytes, raw.length + SETTLEMENT_CAPTURE_LIMITS.overshootBytes);
  }));
}

test('partial stream retains reservation, attempt cap blocks retries, and corrupt cache evidence is preserved', async () => setup(async (root, raw, spec) => {
  const interrupted: typeof fetch = async () => {
    let sent = false;
    const result = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (!sent) { sent = true; controller.enqueue(new Uint8Array(raw.subarray(0, 7))); }
      else controller.error(new Error('fixture interrupted'));
    } }), { status: 200, headers: { 'content-type': 'application/geo+json' } });
    Object.defineProperty(result, 'url', { value: rawUrl(release) }); return result;
  };
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: interrupted }), /fixture interrupted/);
  const audit = await rows(root); const start = audit.find(row => row.event === 'started')!, finish = audit.find(row => row.event === 'finished')!;
  assert.equal(finish.networkBytesMeasured, 7); assert.equal(finish.complete, false); assert.equal(finish.reservedNetworkBytes, start.reservedNetworkBytes);
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: interrupted }), /fixture interrupted/);
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: interrupted }), /two-attempt limit/);
  assert.equal((await (await import('node:fs/promises')).readdir(cacheRoot(root))).some(name => name.endsWith('.geojson')), false);
}));

test('short or altered body bytes fail Git blob verification and are durably measured', async () => setup(async (root, raw, spec) => {
  const short = Buffer.from(raw.subarray(0, raw.length - 1));
  const shortResponse = new Response(short, { status: 200, headers: { 'content-type': 'application/geo+json' } });
  Object.defineProperty(shortResponse, 'url', { value: rawUrl(release) });
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => shortResponse }), /length or Git blob SHA-1/);
  const finish = (await rows(root)).find(row => row.event === 'finished')!;
  assert.equal(finish.complete, true); assert.equal(finish.networkBytesMeasured, short.length);
  assert.equal(finish.reservedNetworkBytes, short.length);
}));

test('an interrupted pending start is retained and charged across a later attempt', async () => setup(async (root, raw, spec) => {
  const identity = { release, path: artifact, blob: spec.expectedGitBlobSha1, expectedBytes: spec.expectedBytes };
  const requestHash = sha(canonical(identity)), attemptId = 'd'.repeat(8) + '-0000-4000-8000-' + 'e'.repeat(12);
  const startedAt = '2026-02-01T00:00:00.000Z';
  const pending = { schemaVersion: 1, requestHash, attemptId, event: 'started', status: 'pending', identity,
    reservedNetworkBytes: raw.length + SETTLEMENT_CAPTURE_LIMITS.overshootBytes, networkBytesMeasured: null, complete: false, startedAt };
  const cache = cacheRoot(root); await mkdir(cache, { recursive: true });
  await writeFile(path.join(cache, 'network-audit.jsonl'), `${canonical(pending)}\n`);
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => { throw new Error('second bounded failure'); } }), /second bounded failure/);
  const audit = await rows(root);
  assert.equal(audit.filter(row => row.event === 'started').length, 2);
  assert.equal(audit.some(row => row.attemptId === attemptId && row.event === 'finished'), false);
  assert.equal(audit.at(-1)?.reservedNetworkBytes, raw.length + SETTLEMENT_CAPTURE_LIMITS.overshootBytes);
}));

test('cache remains readable when the durable audit shows the request attempt limit', async () => setup(async (root, raw, spec) => {
  const first = await acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => response(raw) });
  const identity = { release, path: artifact, blob: spec.expectedGitBlobSha1, expectedBytes: spec.expectedBytes };
  const requestHash = sha(canonical(identity)), attemptId = 'f'.repeat(8) + '-0000-4000-8000-' + '1'.repeat(12);
  const startedAt = '2026-03-01T00:00:00.000Z', reservation = raw.length + SETTLEMENT_CAPTURE_LIMITS.overshootBytes;
  const start = { schemaVersion: 1, requestHash, attemptId, event: 'started', status: 'pending', identity, reservedNetworkBytes: reservation, networkBytesMeasured: null, complete: false, startedAt };
  const finish = { schemaVersion: 1, requestHash, attemptId, event: 'finished', status: 'failure', identity, reservedNetworkBytes: reservation, networkBytesMeasured: null, complete: false, startedAt, endedAt: startedAt, reason: 'synthetic prior failure' };
  await writeFile(path.join(cacheRoot(root), 'network-audit.jsonl'), `${(await readFile(path.join(cacheRoot(root), 'network-audit.jsonl'), 'utf8'))}${canonical(start)}\n${canonical(finish)}\n`);
  const hit = await acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => { throw new Error('cache hit contacted network'); } });
  assert.equal(hit.inputPath, first.inputPath); assert.equal(hit.cacheHit, true); assert.equal(hit.networkBytes, 0);
}));

test('rejects corrupt receipts and symlinked cache ancestry without repair or transport', async () => setup(async (root, raw, spec) => {
  const result = await acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => response(raw) });
  await writeFile(result.receiptPath, '{corrupt}\n');
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => { throw new Error('must not fetch'); } }), /not canonical|JSON|receipt/);
  await rm(cacheRoot(root), { recursive: true, force: true });
  const outside = await mkdtemp(path.join(await realpath(os.tmpdir()), 'settlement-outside-'));
  try {
    await symlink(outside, cacheRoot(root));
    await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => response(raw) }), /unsafe|symlink|directory/);
  } finally { await rm(outside, { recursive: true, force: true }); }
}));

test('orphan receipt is retained and not silently repaired by a network capture', async () => setup(async (root, raw, spec) => {
  const result = await acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => response(raw) });
  await (await import('node:fs/promises')).unlink(result.inputPath);
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => { throw new Error('must not fetch'); } }), /orphan receipt/);
  assert.equal(await readFile(result.receiptPath, 'utf8').then(text => text.length > 0), true);
}));

test('cache-only fails without a source and malformed audit fails closed', async () => setup(async (root, raw, spec) => {
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, cacheOnly: true }), /cache-only/);
  const dir = cacheRoot(root); await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'network-audit.jsonl'), '{not-json}\n');
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => response(raw) }), /audit|JSON/);
}));

test('unknown failed transfers reserve lifetime network allowance across release identities', async () => {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'settlement-lifetime-'));
  const raw = Buffer.from('fixture bytes');
  try {
    const cache = cacheRoot(root); await mkdir(cache, { recursive: true });
    const records: Record<string, unknown>[] = [];
    for (const revision of ['b'.repeat(40), 'c'.repeat(40)]) {
      const identity = { release: revision, path: artifact, blob: blob(raw), expectedBytes: 32 * 1024 * 1024 };
      const requestHash = sha(canonical(identity)), attemptId = `${revision.slice(0, 8)}-0000-4000-8000-${revision.slice(8, 20)}`;
      const startedAt = '2026-01-01T00:00:00.000Z', reservation = identity.expectedBytes + SETTLEMENT_CAPTURE_LIMITS.overshootBytes;
      records.push({ schemaVersion: 1, requestHash, attemptId, event: 'started', status: 'pending', identity, reservedNetworkBytes: reservation, networkBytesMeasured: null, complete: false, startedAt });
      records.push({ schemaVersion: 1, requestHash, attemptId, event: 'finished', status: 'failure', identity, reservedNetworkBytes: reservation, networkBytesMeasured: null, complete: false, startedAt, endedAt: startedAt, reason: 'synthetic prior interrupted attempt' });
    }
    await writeFile(path.join(cache, 'network-audit.jsonl'), records.map(row => `${canonical(row)}\n`).join(''));
    const spec = await writeMetadata(root, raw);
    await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => { throw new Error('must be blocked before network'); } }), /lifetime 64 MiB/);
    assert.equal((await rows(root)).length, 4);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('different request identities append to the same family audit journal', async () => {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'settlement-multi-request-'));
  const raw = Buffer.from('synthetic short capture');
  try {
    for (const revision of ['2'.repeat(40), '3'.repeat(40)]) {
      const spec = await writeMetadata(root, raw, revision);
      await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => { throw new Error(`fixture ${revision[0]} failure`); } }), /fixture [23] failure/);
    }
    const audit = await rows(root);
    assert.equal(audit.filter(row => row.event === 'started').length, 2);
    assert.equal(audit.filter(row => row.event === 'finished').length, 2);
    assert.notEqual(audit[0]?.requestHash, audit[2]?.requestHash);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('immutable source publication collision never replaces the pre-existing path', async () => setup(async (root, raw, spec) => {
  const identity = { release, path: artifact, blob: spec.expectedGitBlobSha1, expectedBytes: spec.expectedBytes };
  const requestHash = sha(canonical(identity)), target = path.join(cacheRoot(root), `${requestHash}.geojson`);
  const retained = Buffer.from('pre-existing collision evidence');
  const fetcher: typeof fetch = async () => {
    await writeFile(target, retained, { flag: 'wx' });
    return response(raw);
  };
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher }), /publication collision/);
  assert.deepEqual(await readFile(target), retained);
  assert.equal((await rows(root)).at(-1)?.status, 'failure');
}));

test('reader setup failure closes the partial file and retains the terminal audit', async () => setup(async (root, raw, spec) => {
  const fetcher: typeof fetch = async () => {
    const locked = response(raw);
    locked.body?.getReader();
    return locked;
  };
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher }), /locked/);
  const records = await rows(root);
  assert.equal(records.at(-1)?.event, 'finished'); assert.equal(records.at(-1)?.status, 'failure');
  assert.equal(records.at(-1)?.reservedNetworkBytes, raw.length + SETTLEMENT_CAPTURE_LIMITS.overshootBytes);
}));

test('verified cache remains readable after the family lacks allowance for another source capture', async () => setup(async (root, raw, spec) => {
  const first = await acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => response(raw) });
  const foreign = await writeMetadata(root, Buffer.alloc(30 * 1024 * 1024, 2), 'b'.repeat(40));
  const failed: typeof fetch = async () => { throw new Error('unknown fixture transfer'); };
  await assert.rejects(acquireSettlementSource(foreign, { repositoryRoot: root, fetcher: failed }), /unknown fixture transfer/);
  await assert.rejects(acquireSettlementSource(foreign, { repositoryRoot: root, fetcher: failed }), /unknown fixture transfer/);
  const restored = await writeMetadata(root, raw);
  const hit = await acquireSettlementSource(restored, { repositoryRoot: root, fetcher: async () => { throw new Error('cache used network'); } });
  assert.equal(hit.cacheHit, true);
  assert.equal(hit.networkBytes, 0);
  assert.equal(hit.requestHash, first.requestHash);
  const audit = await rows(root);
  const charge = audit.filter(row => row.event === 'finished').reduce((sum, row) => sum + Number(row.reservedNetworkBytes), 0);
  assert.ok(charge <= SETTLEMENT_CAPTURE_LIMITS.networkBytes);
  assert.ok(charge + raw.length + SETTLEMENT_CAPTURE_LIMITS.overshootBytes > SETTLEMENT_CAPTURE_LIMITS.networkBytes);
}, Buffer.alloc(3 * 1024 * 1024, 1)));

test('abort during a pending body read returns promptly and keeps its reservation', async () => setup(async (root, raw, spec) => {
  const controller = new AbortController();
  let started!: () => void;
  const fetchStarted = new Promise<void>(resolve => { started = resolve; });
  const fetcher: typeof fetch = async () => {
    started();
    const result = new Response(new ReadableStream<Uint8Array>({
      pull() { return new Promise<void>(() => {}); },
      cancel() { return new Promise<void>(() => {}); },
    }), {
      status: 200, headers: { 'content-type': 'application/geo+json' },
    });
    Object.defineProperty(result, 'url', { value: rawUrl(release) });
    return result;
  };
  const operation = acquireSettlementSource(spec, { repositoryRoot: root, fetcher, signal: controller.signal });
  await fetchStarted;
  const timer = setTimeout(() => controller.abort(new Error('fixture cancellation')), 20);
  try {
    await assert.rejects(operation, /fixture cancellation/);
  } finally { clearTimeout(timer); }
  const finish = (await rows(root)).find(row => row.event === 'finished')!;
  assert.equal(finish.status, 'aborted'); assert.equal(finish.complete, false);
  assert.equal(finish.networkBytesMeasured, null);
  assert.equal(finish.reservedNetworkBytes, raw.length + SETTLEMENT_CAPTURE_LIMITS.overshootBytes);
}));

test('cache traversal entry cap rejects before durable network start', async () => setup(async (root, raw, spec) => {
  const directory = cacheRoot(root); await mkdir(directory, { recursive: true });
  await Promise.all(Array.from({ length: SETTLEMENT_CAPTURE_LIMITS.scanEntries + 1 }, (_, index) =>
    writeFile(path.join(directory, `entry-${index}.empty`), Buffer.alloc(0))));
  let calls = 0;
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => { calls++; return response(raw); } }), /512 entries/);
  assert.equal(calls, 0);
  assert.equal(await readFile(path.join(directory, 'network-audit.jsonl')).then(() => true, () => false), false);
}));

test('cache byte cap rejects before durable network start', async () => setup(async (root, raw, spec) => {
  const directory = cacheRoot(root); await mkdir(directory, { recursive: true });
  const oversized = path.join(directory, 'oversized.sparse'); await writeFile(oversized, Buffer.alloc(0));
  await truncate(oversized, SETTLEMENT_CAPTURE_LIMITS.cacheBytes + 1);
  let calls = 0;
  await assert.rejects(acquireSettlementSource(spec, { repositoryRoot: root, fetcher: async () => { calls++; return response(raw); } }), /64 MiB/);
  assert.equal(calls, 0);
  assert.equal(await readFile(path.join(directory, 'network-audit.jsonl')).then(() => true, () => false), false);
}));
