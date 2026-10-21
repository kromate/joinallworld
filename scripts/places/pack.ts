// Pack the raw GLBs the Blender worker wrote: gltfpack (meshopt + quantisation, vertex colours and UVs kept), brotli measurement,
// content hash, brotli gates from docs/agent-plans/unique-places/CONTRACT.md.
//
//   node --experimental-strip-types scripts/places/pack.ts [--out scripts/places/out] [--only city/venueId,...] [--keep-raw]
//
// For every <out>/<city>/<venueId>.json report with status "ok" it writes <venueId>.lod{n}.<sha8>.glb next to the raw files, removes
// older packed files of the same LOD, and records `packed.lod{n} = {file, bytes, brotliBytes, sha256, triangles}` in the report.
// A model over a brotli gate (LOD0 110,000, LOD1 30,000, LOD2 6,000 bytes) turns the report into status "rejected" with an error line.
// The `trim` material is NOT given a texture here: the game binds the one global atlas (scripts/places/atlas/trim.webp).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants } from 'node:zlib'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const BROTLI_GATE: Record<number, number> = { 0: 110_000, 1: 30_000, 2: 6000 } // the game budgets (src/scene/places/limits.ts)
// Quantisation: 14-bit positions (7 mm over 120 m), 12-bit UVs (atlas is 2048 px), 8-bit normals and colours.
const PACK_ARGS = ['-cc', '-km', '-vp', '14', '-vt', '12', '-vn', '8', '-vc', '8', '-kv']

let cli: string | undefined
/** Path of gltfpack@1.3.0's cli.js in the npx cache (fetched once through npx), so each file costs a node start, not an npx start. */
function gltfpackCli(): string {
  if (cli) return cli
  const find = (): string | undefined => {
    const root = join(homedir(), '.npm', '_npx')
    if (!existsSync(root)) return undefined
    for (const d of readdirSync(root)) {
      const pkg = join(root, d, 'node_modules', 'gltfpack', 'package.json')
      if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).version === '1.3.0') return join(root, d, 'node_modules', 'gltfpack', 'cli.js')
    }
    return undefined
  }
  cli = find()
  if (!cli) {
    execFileSync('npx', ['-y', 'gltfpack@1.3.0', '-h'], { stdio: 'ignore', cwd: repo })
    cli = find()
  }
  if (!cli) throw new Error('gltfpack@1.3.0 could not be fetched through npx')
  return cli
}

export function gltfpackFile(inFile: string, outFile: string): void {
  execFileSync(process.execPath, [gltfpackCli(), '-i', inFile, '-o', outFile, ...PACK_ARGS], { stdio: ['ignore', 'ignore', 'pipe'] })
}

export const brotliSize = (b: Buffer): number => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length

function glbJson(b: Buffer): any {
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'))
}

/** Structural checks on a packed model; returns problems (empty = fine). */
export function checkPacked(b: Buffer): string[] {
  const j = glbJson(b)
  const problems: string[] = []
  if (j.images?.length) problems.push('embeds an image (the atlas must not be embedded)')
  if (j.cameras?.length) problems.push('contains a camera')
  if (j.animations?.length) problems.push('contains animation')
  if (j.extensions?.KHR_lights_punctual) problems.push('contains lights')
  const names = (j.materials ?? []).map((m: any) => m.name)
  if (names.length !== 1 || names[0] !== 'trim') problems.push(`materials must be exactly ["trim"], got ${JSON.stringify(names)}`)
  const attrs = new Set<string>()
  for (const m of j.meshes ?? []) for (const p of m.primitives) Object.keys(p.attributes).forEach((a) => attrs.add(a))
  for (const need of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']) if (!attrs.has(need)) problems.push(`missing ${need}`)
  return problems
}

export interface PackedLod { file: string; bytes: number; brotliBytes: number; sha256: string; triangles: number }

export function packReport(dir: string, venueId: string): { status: string; errors: string[] } | undefined {
  const reportPath = join(dir, `${venueId}.json`)
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const PACK_ERROR = /^LOD\d: (brotli|raw GLB|embeds|contains|materials|missing)/
  const workerErrors = (report.errors ?? []).filter((e: string) => !PACK_ERROR.test(e))
  if (report.status === 'error' || workerErrors.length) return undefined  // the worker rejected it: nothing to pack
  const tmp = mkdtempSync(join(tmpdir(), 'aw-places-'))
  const errors: string[] = []
  const packed: Record<string, PackedLod> = {}
  try {
    for (const lod of [0, 1, 2]) {
      const raw = join(dir, `${venueId}.lod${lod}.raw.glb`)
      if (!existsSync(raw)) { errors.push(`LOD${lod}: raw GLB missing`); continue }
      const out = join(tmp, `lod${lod}.glb`)
      gltfpackFile(raw, out)
      const bytes = readFileSync(out)
      const sha = createHash('sha256').update(bytes).digest('hex')
      const bro = brotliSize(bytes)
      for (const p of checkPacked(bytes)) errors.push(`LOD${lod}: ${p}`)
      if (bro > BROTLI_GATE[lod]!) errors.push(`LOD${lod}: brotli ${bro} bytes is over the ${BROTLI_GATE[lod]} gate`)
      const file = `${venueId}.lod${lod}.${sha.slice(0, 8)}.glb`
      for (const f of readdirSync(dir)) if (f.startsWith(`${venueId}.lod${lod}.`) && f.endsWith('.glb') && !f.endsWith('.raw.glb') && f !== file) rmSync(join(dir, f))
      writeFileSync(join(dir, file), bytes)
      packed[`lod${lod}`] = { file, bytes: bytes.length, brotliBytes: bro, sha256: sha, triangles: report.triangles?.[`lod${lod}`] ?? 0 }
    }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  report.packed = packed
  report.status = errors.length ? 'rejected' : 'packed'
  report.errors = [...workerErrors, ...errors]
  writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n')
  return { status: report.status, errors }
}

function main(): void {
  const args = process.argv.slice(2)
  const opt = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  const out = resolve(repo, opt('--out') ?? 'scripts/places/out')
  const only = new Set((opt('--only') ?? '').split(',').filter(Boolean))
  const dropRaw = args.includes('--drop-raw')
  let bad = 0
  for (const city of readdirSync(out)) {
    const dir = join(out, city)
    if (!statSync(dir).isDirectory()) continue
    for (const f of readdirSync(dir)) {
      const m = /^(.+)\.json$/.exec(f)
      if (!m) continue
      const id = m[1]!
      if (only.size && !only.has(`${city}/${id}`) && !only.has(id)) continue
      const r = packReport(dir, id)
      if (!r) { console.log(`${city}/${id}: skipped (not ok)`); continue }
      const p = JSON.parse(readFileSync(join(dir, f), 'utf8')).packed
      console.log(`${city}/${id}: ${r.status}  ` + [0, 1, 2].map((l) => p?.[`lod${l}`] ? `LOD${l} ${p[`lod${l}`].triangles} tris ${p[`lod${l}`].bytes} B packed, ${p[`lod${l}`].brotliBytes} B brotli` : `LOD${l} -`).join(' | '))
      if (r.errors.length) { bad++; for (const e of r.errors) console.log(`  ! ${e}`) }
      if (dropRaw) for (let l = 0; l < 3; l++) rmSync(join(dir, `${id}.lod${l}.raw.glb`), { force: true })
    }
  }
  if (bad) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
