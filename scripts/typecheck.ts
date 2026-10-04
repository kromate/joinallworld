// npm run typecheck — vue-tsc --noEmit over every project in tsconfig/, held to a tracked baseline.
//
// New code (.ts, .vue) must be clean: one error there fails the run.
// Existing JavaScript is checked in place (allowJs + checkJs, strict). It was written without
// types, so it starts with a recorded number of errors per file and per error code
// (tsconfig/baseline.json). The run fails when a file has MORE errors of a code than recorded, and
// says when it has fewer, so the baseline only ever shrinks.
//
//   node scripts/typecheck.ts                 check
//   node scripts/typecheck.ts --update        rewrite the baseline from what is true now
//   node scripts/typecheck.ts --list [code]   print every baselined error that is not a plain
//                                              "untyped" one (or only those with the given TS code)
//   node scripts/typecheck.ts --summary       print the totals recorded in the baseline
//
// Each project checks the files it owns under the globals of the runtime that executes them:
//   engine  src/game, src/life.ts, src/types    no DOM, no Node (it runs in three runtimes)
//   client  the rest of src/                    DOM + Vite
//   server  server/, scripts/, vite.config.ts, deploy/local.ts   Node
//   worker  deploy/*.ts (not the tests or local.ts) and the two server modules the Worker imports     Workers runtime
//   test    every *.test.js / *.test.ts (deploy/*.test.ts included)       Node + DOM
// A file reached only through an import is checked by the project that owns it, not twice.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(root, 'tsconfig', 'baseline.json')
const isTest = (file: string): boolean => /\.test\.(js|ts|mjs)$/.test(file)
const isEngine = (file: string): boolean => file.startsWith('src/game/') || file === 'src/life.ts' || file.startsWith('src/types/')

type Codes = Record<string, number>
type Files = Record<string, Codes>
interface Baseline { note?: string; projects: Record<string, Files> }
interface TypeError { project: string; file: string; line: number; column: number; code: string; message: string }
interface RunResult { project: string; out: string; status: number | null }

/** Which files each project answers for. */
export const PROJECTS: Record<string, (file: string) => boolean> = {
  engine: (file) => !isTest(file) && isEngine(file),
  client: (file) => !isTest(file) && !isEngine(file) && (file.startsWith('src/') || file === 'env.d.ts'),
  server: (file) => !isTest(file) && (file.startsWith('server/') || file.startsWith('scripts/') || file.startsWith('vite.config.') || file === 'deploy/local.ts'),
  worker: (file) => !isTest(file) && (/^deploy\/[^/]+\.ts$/.test(file) && file !== 'deploy/local.ts' || file === 'server/protocol.ts' || file === 'server/life-service.ts'),
  test: (file) => isTest(file),
}
/** Codes that only say "this JavaScript has no type annotations yet". Everything else is worth reading. */
export const UNTYPED = new Set<string>(['TS7005', 'TS7006', 'TS7008', 'TS7010', 'TS7011', 'TS7015', 'TS7016', 'TS7018', 'TS7019', 'TS7022', 'TS7023', 'TS7024', 'TS7031', 'TS7034', 'TS7053'])
const isLegacy = (file: string): boolean => /\.(js|mjs)$/.test(file)

function run(project: string): Promise<RunResult> {
  return new Promise((done) => {
    const bin = join(root, 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js')
    const child = spawn(process.execPath, [bin, '--noEmit', '--pretty', 'false', '-p', join('tsconfig', `${project}.json`)], { cwd: root })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => { out += chunk })
    child.stderr.on('data', (chunk: Buffer) => { out += chunk })
    child.on('close', (status: number | null) => done({ project, out, status }))
  })
}

/** tsc prints `path(line,col): error TS1234: message`; continuation lines are indented. */
function parse(project: string, out: string): { errors: TypeError[]; stray: string[] } {
  const errors: TypeError[] = []
  const stray: string[] = []
  for (const line of out.split('\n')) {
    const match = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line)
    if (match) {
      const file = relative(root, resolve(root, match[1] as string)).split('\\').join('/')
      errors.push({ project, file, line: Number(match[2]), column: Number(match[3]), code: match[4] as string, message: match[5] as string })
    } else if (/^error TS\d+/.test(line)) stray.push(line)
  }
  return { errors, stray }
}

function tally(errors: TypeError[]): Files {
  const files: Files = {}
  for (const error of errors) {
    const codes = (files[error.file] ??= {})
    codes[error.code] = (codes[error.code] ?? 0) + 1
  }
  const sorted: Files = {}
  for (const file of Object.keys(files).sort()) {
    sorted[file] = Object.fromEntries(Object.entries(files[file] as Codes).sort(([a], [b]) => (a < b ? -1 : 1)))
  }
  return sorted
}

const sum = (files: Files, keep: (code: string) => boolean = () => true): number => Object.values(files).reduce((total, codes) => total + Object.entries(codes).reduce((n, [code, count]) => n + (keep(code) ? count : 0), 0), 0)

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline
  if (args.includes('--summary')) {
    let files = 0, total = 0, untyped = 0
    for (const [project, entry] of Object.entries(baseline.projects)) {
      const count = Object.keys(entry).length, all = sum(entry), plain = sum(entry, (code) => UNTYPED.has(code))
      files += count; total += all; untyped += plain
      console.log(`${project.padEnd(7)} ${String(count).padStart(4)} files  ${String(all).padStart(6)} errors  (${plain} untyped, ${all - plain} other)`)
    }
    console.log(`${'total'.padEnd(7)} ${String(files).padStart(4)} files  ${String(total).padStart(6)} errors  (${untyped} untyped, ${total - untyped} other)`)
    return 0
  }

  const results = await Promise.all(Object.keys(PROJECTS).map(run))
  const owned: Record<string, TypeError[]> = {}
  const failures: string[] = []
  const notes: string[] = []
  for (const { project, out } of results) {
    const { errors, stray } = parse(project, out)
    // A configuration error (a missing file, a bad option) has no path: never baselined.
    for (const line of stray) failures.push(`${project}: ${line}`)
    if (!errors.length && !stray.length && out.trim() && !/^\s*$/.test(out)) notes.push(`${project}: ${out.trim().split('\n')[0]}`)
    owned[project] = errors.filter((error) => (PROJECTS[project] as (file: string) => boolean)(error.file))
  }

  if (args.includes('--list')) {
    const only = args[args.indexOf('--list') + 1]
    for (const project of Object.keys(PROJECTS)) {
      for (const error of owned[project] as TypeError[]) {
        if (only ? error.code !== only : UNTYPED.has(error.code)) continue
        console.log(`${project}\t${error.file}:${error.line}:${error.column}\t${error.code}\t${error.message}`)
      }
    }
    return 0
  }

  const next: Baseline & { note: string } = { note: 'Generated by `node scripts/typecheck.ts --update`. Errors the type checker reports in existing JavaScript, per project, file and error code. It may only shrink: see docs/MIGRATION-VUE-TS.md.', projects: {} }
  for (const project of Object.keys(PROJECTS)) {
    const fresh = (owned[project] as TypeError[]).filter((error) => !isLegacy(error.file))
    for (const error of fresh) failures.push(`${error.file}:${error.line}:${error.column} ${error.code} ${error.message}`)
    const legacy = (owned[project] as TypeError[]).filter((error) => isLegacy(error.file))
    const now = tally(legacy)
    next.projects[project] = now
    const was = baseline.projects[project] ?? {}
    for (const [file, codes] of Object.entries(now)) {
      for (const [code, count] of Object.entries(codes)) {
        const allowed = was[file]?.[code] ?? 0
        if (count > allowed) {
          failures.push(`${file}: ${count} × ${code} in the ${project} project, the baseline allows ${allowed}:`)
          for (const error of legacy) if (error.file === file && error.code === code) failures.push(`    ${error.file}:${error.line}:${error.column} ${error.message}`)
        } else if (count < allowed) notes.push(`${file}: ${code} is down from ${allowed} to ${count} (${project})`)
      }
    }
    for (const [file, codes] of Object.entries(was)) {
      for (const [code, allowed] of Object.entries(codes)) if (!now[file]?.[code]) notes.push(`${file}: ${code} is down from ${allowed} to 0 (${project})`)
    }
  }

  if (args.includes('--update')) {
    const hard = failures.filter((line) => !/the baseline allows|^ {4}/.test(line))
    if (hard.length) { console.error(hard.join('\n')); console.error('\nThe baseline holds JavaScript only. Fix the errors above first.'); return 1 }
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 1)}\n`)
    console.log(`Baseline written: ${Object.values(next.projects).reduce((n, files) => n + Object.keys(files).length, 0)} files, ${Object.values(next.projects).reduce((n, files) => n + sum(files), 0)} errors.`)
    return 0
  }
  if (failures.length) {
    console.error(failures.join('\n'))
    console.error(`\nTypecheck failed. New .ts and .vue code must be clean. For existing JavaScript, fix the new errors; if they came in with a merge of untyped code, record them with \`node scripts/typecheck.ts --update\` and say so in the commit.`)
    return 1
  }
  const total = Object.values(next.projects).reduce((n, files) => n + sum(files), 0)
  if (notes.length) console.log(`${notes.length} baseline entr${notes.length === 1 ? 'y is' : 'ies are'} now lower than recorded. Run \`node scripts/typecheck.ts --update\` to keep the gain.`)
  console.log(`Typecheck clean: ${Object.keys(PROJECTS).length} projects, 0 errors in .ts and .vue, ${total} baselined in existing JavaScript.`)
  return 0
}

process.exitCode = await main()
