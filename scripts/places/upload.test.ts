// OWNER: scenes (unique places) — scripts/places/upload.ts: the plan, the ledger, the bounded parallel upload, both transports and --dry-run.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CACHE_CONTROL, CONTENT_TYPE, hasS3Credentials, main, planUploads, readLedger, s3Transport, signRequest, uploadAll, wranglerArgs, wranglerTransport, writeLedger } from './upload.ts'
import type { Job, Transport } from './upload.ts'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const glb = (n: number) => { const bytes = new Uint8Array(24); bytes.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 24], 0); bytes[20] = n; return bytes }
const lod = (bytes: Uint8Array, triangles = 10) => ({ sha256: sha(bytes), bytes: bytes.length, brotliBytes: 5, triangles })
const ATLAS = 'c'.repeat(64)

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'places-upload-')), store = join(dir, 'store'), manifests = join(dir, 'manifest')
  mkdirSync(store); mkdirSync(manifests)
  const put = (bytes: Uint8Array) => { writeFileSync(join(store, `${sha(bytes)}.glb`), bytes); return lod(bytes) }
  const manifest = (city: string, venues: Record<string, unknown>) => writeFileSync(join(manifests, `${city}.json`), JSON.stringify({ schema: 'allworld-place-models', version: 1, city, atlas: { url: `/assets/places/trim-${ATLAS}.webp`, sha256: ATLAS }, venues }))
  return { dir, store, manifests, put, manifest, ledger: join(dir, 'cache', 'uploaded.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('SigV4 matches the AWS documentation vector for a PUT with extra signed headers', () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html (PUT Object example)
  const authorization = signRequest({
    method: 'PUT', host: 'examplebucket.s3.amazonaws.com', path: '/test$file.text', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 's3', amzDate: '20130524T000000Z',
    payloadSha256: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
    headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', Host: 'examplebucket.s3.amazonaws.com', 'x-amz-date': '20130524T000000Z', 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072' },
  })
  assert.equal(authorization, 'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd')
})

test('the plan lists each hash once, skips what the ledger holds, and reports files that are not in the store', () => {
  const w = workspace()
  try {
    const a = w.put(glb(1)), b = w.put(glb(2)), c = w.put(glb(3)), absent = lod(glb(9))
    w.manifest('abuja', { airport: { archetype: 'airport-terminal', lod0: a, lod1: b, lod2: c }, clinic: { archetype: 'hospital', lod0: a, lod1: b, lod2: absent } })
    w.manifest('lagos', { airport: { archetype: 'airport-terminal', lod0: a, lod1: b, lod2: c } })
    const plan = planUploads({ manifests: w.manifests, store: w.store })
    assert.deepEqual(plan.cities, ['abuja', 'lagos']); assert.equal(plan.venues, 3)
    assert.deepEqual(plan.jobs.map(job => job.sha256).sort(), [a.sha256, b.sha256, c.sha256].sort(), 'shared files are sent once')
    assert.deepEqual(plan.missing, [absent.sha256])
    assert.ok(plan.jobs.every(job => job.key === `places/${job.sha256}.glb`))
    const again = planUploads({ manifests: w.manifests, store: w.store, ledger: { [a.sha256]: { bytes: 24, at: 'x' } } })
    assert.deepEqual(again.alreadyUploaded, [a.sha256]); assert.equal(again.jobs.length, 2)
    assert.equal(planUploads({ manifests: w.manifests, store: w.store, ledger: { [a.sha256]: { bytes: 24, at: 'x' } }, force: true }).jobs.length, 3, '--force ignores the ledger')
    assert.equal(planUploads({ manifests: w.manifests, store: w.store, cities: ['lagos'] }).jobs.length, 3)
  } finally { w.cleanup() }
})

test('uploads run at most `concurrency` at a time, record each success in the ledger, and one failure does not stop the rest', async () => {
  const w = workspace()
  try {
    const entries = [1, 2, 3, 4, 5, 6, 7].map(n => w.put(glb(n)))
    const jobs: Job[] = entries.map(e => ({ sha256: e.sha256, key: `places/${e.sha256}.glb`, path: join(w.store, `${e.sha256}.glb`), bytes: e.bytes }))
    let running = 0, peak = 0
    const transport: Transport = { describe: job => job.key, async put(job) { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running--; if (job.sha256 === entries[3]!.sha256) throw new Error('503 from R2') } }
    const ledger = {}
    const report = await uploadAll(jobs, transport, { concurrency: 3, ledger, ledgerPath: w.ledger, now: () => new Date('2026-10-19T12:00:00Z') })
    assert.equal(peak, 3); assert.equal(report.uploaded.length, 6); assert.deepEqual(report.failed.map(f => f.sha256), [entries[3]!.sha256]); assert.match(report.failed[0]!.error, /503/)
    const saved = readLedger(w.ledger)
    assert.deepEqual(Object.keys(saved).sort(), report.uploaded.slice().sort(), 'only successes are recorded')
    assert.deepEqual(saved[entries[0]!.sha256], { bytes: 24, at: '2026-10-19T12:00:00.000Z' })
    // The concurrency is clamped to 1..16.
    peak = 0; const wide = await uploadAll(jobs.slice(0, 2), { ...transport, async put() { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 2)); running-- } }, { concurrency: 999, ledgerPath: w.ledger })
    assert.equal(wide.uploaded.length, 2); assert.ok(peak <= 16)
  } finally { w.cleanup() }
})

test('a file that does not hash to its name, or is not the manifest size, is never sent', async () => {
  const w = workspace()
  try {
    const good = w.put(glb(1)), name = sha(glb(2))
    writeFileSync(join(w.store, `${name}.glb`), glb(77))
    const sent: string[] = []
    const transport: Transport = { describe: job => job.key, async put(job) { sent.push(job.sha256) } }
    const report = await uploadAll([
      { sha256: name, key: `places/${name}.glb`, path: join(w.store, `${name}.glb`), bytes: 24 },
      { sha256: good.sha256, key: `places/${good.sha256}.glb`, path: join(w.store, `${good.sha256}.glb`), bytes: 999 },
    ], transport, { persist: false })
    assert.deepEqual(sent, []); assert.equal(report.failed.length, 2)
    assert.match(report.failed[0]!.error, /does not hash to its name/); assert.match(report.failed[1]!.error, /manifest says 999/)
  } finally { w.cleanup() }
})

test('wrangler: the exact command, run with npx, and a failing exit code is an error', async () => {
  const job: Job = { sha256: 'a'.repeat(64), key: `places/${'a'.repeat(64)}.glb`, path: '/store/a.glb', bytes: 1 }
  assert.deepEqual(wranglerArgs(job, 'allworld'), ['wrangler@4', 'r2', 'object', 'put', `allworld/places/${'a'.repeat(64)}.glb`, '--file', '/store/a.glb', '--content-type', CONTENT_TYPE, '--cache-control', CACHE_CONTROL, '--remote'])
  assert.equal(CONTENT_TYPE, 'model/gltf-binary')
  const calls: string[][] = []
  await wranglerTransport('allworld', async (command, args) => { calls.push([command, ...args]); return { code: 0, output: '' } }).put(job, new Uint8Array(1))
  assert.deepEqual(calls[0]!.slice(0, 3), ['npx', '--yes', 'wrangler@4'])
  await assert.rejects(wranglerTransport('allworld', async () => ({ code: 1, output: 'Not logged in\nrun wrangler login' })).put(job, new Uint8Array(1)), /exit 1.*wrangler login/)
})

test('S3: a signed PUT to the account endpoint with the model headers; an error status fails the upload', async () => {
  const env = { R2_ACCESS_KEY_ID: 'AKID', R2_SECRET_ACCESS_KEY: 'secret', ALLWORLD_CF_ACCOUNT_ID: 'acct123' }
  assert.equal(hasS3Credentials(env), true); assert.equal(hasS3Credentials({ ...env, R2_SECRET_ACCESS_KEY: '' }), false)
  const bytes = glb(5), job: Job = { sha256: sha(bytes), key: `places/${sha(bytes)}.glb`, path: 'x', bytes: bytes.length }
  const seen: { url: string; init: RequestInit }[] = []
  const send = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response('', { status: 200 }) }) as unknown as typeof fetch
  await s3Transport(env, 'allworld', send, () => new Date('2026-10-19T08:30:00Z')).put(job, bytes)
  assert.equal(seen[0]!.url, `https://acct123.r2.cloudflarestorage.com/allworld/places/${job.sha256}.glb`)
  const headers = seen[0]!.init.headers as Record<string, string>
  assert.equal(seen[0]!.init.method, 'PUT'); assert.equal(headers['content-type'], 'model/gltf-binary'); assert.equal(headers['cache-control'], CACHE_CONTROL)
  assert.equal(headers['x-amz-content-sha256'], sha(bytes)); assert.equal(headers['x-amz-date'], '20261019T083000Z')
  assert.match(headers.authorization!, /^AWS4-HMAC-SHA256 Credential=AKID\/20261019\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
  assert.equal(seen[0]!.init.body, bytes)
  const refused = (async () => new Response('AccessDenied', { status: 403 })) as unknown as typeof fetch
  await assert.rejects(s3Transport(env, 'allworld', refused).put(job, bytes), /403.*AccessDenied/)
})

test('--dry-run reads the manifests and the store and sends and writes nothing', async () => {
  const w = workspace(), logs: string[] = [], log = console.log
  try {
    const a = w.put(glb(1)), b = w.put(glb(2)), c = w.put(glb(3))
    w.manifest('abuja', { airport: { archetype: 'airport-terminal', lod0: a, lod1: b, lod2: c } })
    console.log = (...args: unknown[]) => { logs.push(args.join(' ')) }
    const code = await main(['--dry-run', '--manifests', w.manifests, '--store', w.store, '--ledger', w.ledger, '--mode', 'wrangler'], {})
    assert.equal(code, 0)
    const text = logs.join('\n')
    assert.match(text, /1 cities, 1 venues: 3 files to upload[\s\S]*dry run: nothing is sent or written/)
    assert.equal((text.match(/npx wrangler@4 r2 object put allworld\/places\//g) ?? []).length, 3, 'one command per file')
    assert.equal(existsSync(w.ledger), false, 'no ledger written')
    logs.length = 0
    assert.equal(await main(['--dry-run', '--manifests', w.manifests, '--store', join(w.dir, 'empty'), '--ledger', w.ledger], {}), 1, 'files missing from the store are an error even in a dry run')
    assert.match(logs.join('\n'), /3 not in/)
    writeLedger({ [a.sha256]: { bytes: 24, at: 't' } }, w.ledger)
    assert.deepEqual(Object.keys(readLedger(w.ledger)), [a.sha256]); assert.equal(readFileSync(w.ledger, 'utf8').endsWith('\n'), true)
    assert.equal(await main(['--mode', 'ftp'], {}), 2); assert.equal(await main(['--concurrency', '40'], {}), 2); assert.equal(await main(['--mode', 's3', '--dry-run'], {}), 2, 's3 needs credentials')
  } finally { console.log = log; w.cleanup() }
})
