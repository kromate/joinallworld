// Partition the existing npm test corpus across hosted runners without changing its globs or concurrency.
import { globSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const prefix = 'node --experimental-strip-types --test --test-concurrency=1 '
const groups = { game: 'src/', host: 'server/', tooling: 'scripts/' }
type Suite = keyof typeof groups
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const script = record(manifest) && record(manifest.scripts) ? manifest.scripts.test : null
if (typeof script !== 'string' || !script.startsWith(prefix)) throw new Error('The npm test command changed; review the complete hosted test plan.')
const suffix = script.slice(prefix.length)
const tokens = suffix.match(/"(?:[^"\\]|\\.)*"/g) ?? []
if (!tokens.length || tokens.join(' ') !== suffix) throw new Error('The npm test glob arguments changed; review the complete hosted test plan.')
const patterns = tokens.map(token => {
  const pattern: unknown = JSON.parse(token)
  if (typeof pattern !== 'string') throw new Error('Every npm test argument must be a glob string.')
  return pattern
})
const plan: Record<Suite, string[]> = { game: [], host: [], tooling: [] }
for (const name of ['game', 'host', 'tooling'] as const) plan[name] = patterns.filter(pattern => pattern.startsWith(groups[name]))
if (Object.values(plan).flat().length !== patterns.length || Object.values(plan).some(group => !group.length)) throw new Error('Every npm test glob must belong to exactly one nonempty hosted partition.')

const ownership = new Map<string, string>()
for (const [name, globs] of Object.entries(plan)) {
  for (const file of new Set(globs.flatMap(pattern => globSync(pattern)))) {
    if (ownership.has(file)) throw new Error(`Test file belongs to multiple partitions: ${file}`)
    ownership.set(file, name)
  }
}
const complete = new Set(patterns.flatMap(pattern => globSync(pattern)))
if (!complete.size || complete.size !== ownership.size || [...complete].some(file => !ownership.has(file))) throw new Error('Hosted partitions do not cover the complete npm test file inventory.')

const selected = process.argv[2]
if (selected === '--plan' && process.argv.length === 3) {
  process.stdout.write(JSON.stringify({ totalFiles: complete.size, partitions: Object.fromEntries(Object.entries(plan).map(([name, globs]) => [name, { globs, files: [...ownership.values()].filter(owner => owner === name).length }])) }, null, 2) + '\n')
} else {
  if (process.argv.length !== 3 || (selected !== 'game' && selected !== 'host' && selected !== 'tooling')) throw new Error('Choose game, host, tooling, or --plan.')
  const child = spawn(process.execPath, ['--experimental-strip-types', '--test', '--test-concurrency=1', ...plan[selected]], { stdio: 'inherit' })
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  for (const signal of signals) process.on(signal, () => child.kill(signal))
  child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })
}
