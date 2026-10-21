// Uploads the packed place models to R2 (Node 22+, run with --experimental-strip-types).
//
//   node --experimental-strip-types scripts/places/upload.ts [--dry-run] [--city abuja,lagos] [--concurrency 8] [--force]
//                                                            [--mode auto|wrangler|s3] [--store scripts/places/out/store] [--bucket allworld] [--manifests scripts/places/manifest]
//
// What goes up: every GLB named by a committed manifest (scripts/places/manifest/*.json), read from the store folder that
// scripts/places/manifest.ts fills (<store>/<sha256>.glb), to the R2 key `places/<sha256>.glb` of the bucket `allworld` (binding MODELS). The
// Worker serves it at /assets/places/<sha256>.glb (deploy/places-route.ts). Keys are content-addressed, so an upload is idempotent and can
// never replace different bytes; a local ledger (scripts/places/.cache/uploaded.json) records what has gone up so a rerun sends only what is new.
// Each file's bytes are hashed again before they are sent and must equal the name.
//
// How: with R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and ALLWORLD_CF_ACCOUNT_ID in the environment, the S3 API (a signed PUT, no dependencies);
// otherwise `npx wrangler@4 r2 object put allworld/places/<sha>.glb --file <path> --content-type model/gltf-binary --remote`, which uses wrangler's
// own login. --mode forces one. 8 to 16 uploads run at once (default 8). --dry-run prints what would be sent and sends and writes nothing.
//
// RELEASE ORDER: upload first, then deploy. A deploy whose manifests name models that are not in R2 still works (every venue falls back to what it
// drew before), but its players would fetch 404s until the upload finishes.
import { spawn } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { placeModelPath, placeObjectKey } from '../../src/scene/places/paths.ts'
import { parsePlaceManifest } from '../../src/scene/places/manifest.ts'

const here = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_STORE = join(here, 'out', 'store')
export const DEFAULT_LEDGER = join(here, '.cache', 'uploaded.json')
export const MANIFEST_DIR = join(here, 'manifest')
export const CACHE_CONTROL = 'public, max-age=31536000, immutable'
export const CONTENT_TYPE = 'model/gltf-binary'
export const MIN_CONCURRENCY = 1
export const MAX_CONCURRENCY = 16

export type Ledger = Record<string, { bytes: number; at: string }>
export interface Job { sha256: string; key: string; path: string; bytes: number }
export interface Plan { jobs: Job[]; alreadyUploaded: string[]; missing: string[]; cities: string[]; venues: number }

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

export function readLedger(path = DEFAULT_LEDGER): Ledger {
  if (!existsSync(path)) return {}
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`The upload ledger ${path} is not an object`)
  return parsed as Ledger
}
export function writeLedger(ledger: Ledger, path = DEFAULT_LEDGER): void {
  mkdirSync(dirname(path), { recursive: true })
  const sorted = Object.fromEntries(Object.keys(ledger).sort().map(key => [key, ledger[key]!]))
  writeFileSync(`${path}.tmp`, `${JSON.stringify(sorted, null, 1)}\n`)
  renameSync(`${path}.tmp`, path)
}

/** Every hash the committed manifests name, once each, with the file in the store that holds it. */
export function planUploads(options: { manifests?: string; store?: string; ledger?: Ledger; cities?: string[]; force?: boolean } = {}): Plan {
  const dir = options.manifests ?? MANIFEST_DIR, store = options.store ?? DEFAULT_STORE, ledger = options.ledger ?? {}
  const names = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(city => !options.cities || options.cities.includes(city)).sort() : []
  const seen = new Set<string>(), jobs: Job[] = [], alreadyUploaded: string[] = [], missing: string[] = []
  let venues = 0
  for (const city of names) {
    const manifest = parsePlaceManifest(JSON.parse(readFileSync(join(dir, `${city}.json`), 'utf8')), city)
    for (const models of Object.values(manifest.venues)) {
      venues++
      for (const lod of [models.lod0, models.lod1, models.lod2]) {
        if (seen.has(lod.sha256)) continue
        seen.add(lod.sha256)
        if (!options.force && ledger[lod.sha256]) { alreadyUploaded.push(lod.sha256); continue }
        const path = join(store, `${lod.sha256}.glb`)
        if (!existsSync(path)) { missing.push(lod.sha256); continue }
        jobs.push({ sha256: lod.sha256, key: placeObjectKey(lod.sha256), path, bytes: lod.bytes })
      }
    }
  }
  return { jobs, alreadyUploaded, missing, cities: names, venues }
}

// ---- AWS Signature Version 4 (the S3 API of R2) -----------------------------------------------------------------------------------

const hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest()
const encode = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
export interface SignInput { method: string; host: string; path: string; query?: string; headers: Record<string, string>; payloadSha256: string; accessKeyId: string; secretAccessKey: string; region: string; service: string; amzDate: string }
/** The Authorization header value for a request whose headers (host and x-amz-date included) are given. Header names are matched case-insensitively. */
export function signRequest(input: SignInput): string {
  const day = input.amzDate.slice(0, 8), scope = `${day}/${input.region}/${input.service}/aws4_request`
  const headers = Object.entries(input.headers).map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const signed = headers.map(([name]) => name).join(';')
  const uri = input.path.split('/').map(segment => encode(segment)).join('/')
  const canonical = [input.method, uri, input.query ?? '', ...headers.map(([name, value]) => `${name}:${value}`), '', signed, input.payloadSha256].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', input.amzDate, scope, hex(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), input.service), 'aws4_request')
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${createHmac('sha256', key).update(toSign).digest('hex')}`
}

export interface Transport {
  /** Sends one file; rejects on failure. */
  put(job: Job, bytes: Uint8Array): Promise<void>
  describe(job: Job): string
}
export interface S3Env { R2_ACCESS_KEY_ID?: string; R2_SECRET_ACCESS_KEY?: string; ALLWORLD_CF_ACCOUNT_ID?: string }
export const hasS3Credentials = (env: S3Env): boolean => Boolean(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.ALLWORLD_CF_ACCOUNT_ID)

export function s3Transport(env: S3Env, bucket: string, send: typeof fetch = fetch, now: () => Date = () => new Date()): Transport {
  const host = `${env.ALLWORLD_CF_ACCOUNT_ID}.r2.cloudflarestorage.com`
  return {
    describe: job => `PUT https://${host}/${bucket}/${job.key}`,
    async put(job, bytes) {
      const amzDate = now().toISOString().replace(/[-:]|\.\d{3}/g, ''), payloadSha256 = hex(bytes)
      const headers = { host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadSha256, 'content-type': CONTENT_TYPE, 'cache-control': CACHE_CONTROL }
      const authorization = signRequest({ method: 'PUT', host, path: `/${bucket}/${job.key}`, headers, payloadSha256, accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY!, region: 'auto', service: 's3', amzDate })
      const { host: _host, ...sent } = headers
      const response = await send(`https://${host}/${bucket}/${job.key.split('/').map(encode).join('/')}`, { method: 'PUT', headers: { ...sent, authorization }, body: bytes as Uint8Array<ArrayBuffer> })
      if (!response.ok) throw new Error(`R2 answered ${response.status} for ${job.key}: ${(await response.text()).slice(0, 200)}`)
    },
  }
}
export type Runner = (command: string, args: string[]) => Promise<{ code: number; output: string }>
export const spawnRunner: Runner = (command, args) => new Promise((done, fail) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''
  child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { output += chunk })
  child.on('error', fail); child.on('close', code => done({ code: code ?? 1, output }))
})
export const wranglerArgs = (job: Job, bucket: string): string[] => ['wrangler@4', 'r2', 'object', 'put', `${bucket}/${job.key}`, '--file', job.path, '--content-type', CONTENT_TYPE, '--cache-control', CACHE_CONTROL, '--remote']
export function wranglerTransport(bucket: string, run: Runner = spawnRunner): Transport {
  return {
    describe: job => `npx ${wranglerArgs(job, bucket).map(arg => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ')}`,
    async put(job) {
      const result = await run('npx', ['--yes', ...wranglerArgs(job, bucket)])
      if (result.code !== 0) throw new Error(`wrangler failed for ${job.key} (exit ${result.code}): ${result.output.trim().split('\n').slice(-3).join(' | ')}`)
    },
  }
}

export interface UploadReport { uploaded: string[]; failed: { sha256: string; error: string }[]; skipped: string[] }

/** Runs the jobs `concurrency` at a time. Each file is read, re-hashed and sent; the ledger is written after every success. */
export async function uploadAll(jobs: Job[], transport: Transport, options: { concurrency?: number; ledger?: Ledger; ledgerPath?: string; persist?: boolean; read?: (path: string) => Uint8Array; now?: () => Date } = {}): Promise<UploadReport> {
  const width = Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, options.concurrency ?? 8)), ledger = options.ledger ?? {}, read = options.read ?? (path => readFileSync(path))
  const report: UploadReport = { uploaded: [], failed: [], skipped: [] }, queue = [...jobs]
  await Promise.all(Array.from({ length: Math.min(width, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const bytes = read(job.path)
        if (sha256Of(bytes) !== job.sha256) throw new Error(`${job.path} does not hash to its name`)
        if (bytes.length !== job.bytes) throw new Error(`${job.path} is ${bytes.length} bytes, the manifest says ${job.bytes}`)
        await transport.put(job, bytes)
        ledger[job.sha256] = { bytes: bytes.length, at: (options.now?.() ?? new Date()).toISOString() }
        if (options.persist !== false) writeLedger(ledger, options.ledgerPath)
        report.uploaded.push(job.sha256)
      } catch (error) { report.failed.push({ sha256: job.sha256, error: error instanceof Error ? error.message : String(error) }) }
    }
  }))
  return report
}

export async function main(argv = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const flag = (name: string) => argv.includes(name), value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const dry = flag('--dry-run'), bucket = value('--bucket') ?? 'allworld', store = resolve(value('--store') ?? DEFAULT_STORE), ledgerPath = resolve(value('--ledger') ?? DEFAULT_LEDGER)
  const mode = value('--mode') ?? 'auto', concurrency = Number(value('--concurrency') ?? 8), cities = value('--city')?.split(',').filter(Boolean)
  if (!['auto', 'wrangler', 's3'].includes(mode)) { console.error('--mode is auto, wrangler or s3'); return 2 }
  if (!Number.isInteger(concurrency) || concurrency < MIN_CONCURRENCY || concurrency > MAX_CONCURRENCY) { console.error(`--concurrency is ${MIN_CONCURRENCY} to ${MAX_CONCURRENCY}`); return 2 }
  const manifests = value('--manifests'), ledger = readLedger(ledgerPath), plan = planUploads({ store, ledger, ...(manifests ? { manifests: resolve(manifests) } : {}), ...(cities ? { cities } : {}), force: flag('--force') })
  const s3 = mode === 's3' || (mode === 'auto' && hasS3Credentials(env))
  if (s3 && !hasS3Credentials(env)) { console.error('--mode s3 needs R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and ALLWORLD_CF_ACCOUNT_ID'); return 2 }
  const transport = s3 ? s3Transport(env, bucket) : wranglerTransport(bucket)
  const total = plan.jobs.reduce((sum, job) => sum + job.bytes, 0)
  console.log(`${plan.cities.length} cities, ${plan.venues} venues: ${plan.jobs.length} files to upload (${(total / 1024).toFixed(0)} KB), ${plan.alreadyUploaded.length} already in the ledger, ${plan.missing.length} not in ${store}`)
  console.log(`via ${s3 ? 'the S3 API' : 'wrangler'} to bucket ${bucket}, ${concurrency} at a time${dry ? ' (dry run: nothing is sent or written)' : ''}`)
  if (plan.missing.length) console.log(`missing from the store (run scripts/places/manifest.ts): ${plan.missing.slice(0, 5).map(h => h.slice(0, 12)).join(', ')}${plan.missing.length > 5 ? ', ...' : ''}`)
  if (dry) {
    for (const job of plan.jobs.slice(0, 20)) console.log(`  ${transport.describe(job)}   (${placeModelPath(job.sha256)})`)
    if (plan.jobs.length > 20) console.log(`  ... and ${plan.jobs.length - 20} more`)
    return plan.missing.length ? 1 : 0
  }
  if (!plan.jobs.length) return plan.missing.length ? 1 : 0
  const report = await uploadAll(plan.jobs, transport, { concurrency, ledger, ledgerPath })
  for (const failure of report.failed) console.error(`FAILED ${failure.sha256}: ${failure.error}`)
  console.log(`uploaded ${report.uploaded.length}, failed ${report.failed.length}`)
  return report.failed.length || plan.missing.length ? 1 : 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().then(code => { process.exitCode = code }, error => { console.error(error); process.exitCode = 1 })
