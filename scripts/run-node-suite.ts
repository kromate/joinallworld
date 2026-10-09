#!/usr/bin/env node
/** Strictly partition package.json's canonical Node test command without invoking a shell. */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED_FLAGS = ['--experimental-strip-types', '--test', '--test-concurrency=1']
const OPTIONAL_REPORTER = '--test-reporter=spec'

function tokenize(script: string): string[] {
  if (typeof script !== 'string' || !script.trim()) throw new Error('Canonical test script is empty.')
  const tokens: string[] = []
  let index = 0
  while (index < script.length) {
    while (/\s/.test(script[index] ?? '')) index++
    if (index >= script.length) break
    if (script[index] === '"') {
      index++
      const start = index
      while (index < script.length && script[index] !== '"') {
        if (script[index] === '\\' || /[;&|<>$`()]/.test(script[index] ?? '')) throw new Error('Unsupported shell syntax in canonical test script.')
        index++
      }
      if (index >= script.length || index === start) throw new Error('Malformed quoted token in canonical test script.')
      const value = script.slice(start, index++)
      if (index < script.length && !/\s/.test(script[index] ?? '')) throw new Error('Quoted token must end at a token boundary.')
      tokens.push(value)
      continue
    }
    const start = index
    while (index < script.length && !/\s/.test(script[index] ?? '')) {
      if (/['"\\;&|<>$`()]/.test(script[index] ?? '')) throw new Error('Unsupported shell syntax in canonical test script.')
      index++
    }
    tokens.push(script.slice(start, index))
  }
  return tokens
}

function safeGlob(value: string): boolean {
  if (typeof value !== 'string' || !/^(?:src|server|scripts)\/[A-Za-z0-9_./*-]+\.test\.(?:js|ts)$/.test(value)) return false
  const segments = value.split('/')
  return segments.every(segment => segment !== '.' && segment !== '..')
}

/** Parse the exact supported npm test command. Unknown changes stop partitioning rather than lose coverage. */
export interface CanonicalTestPlan {
  readonly flags: readonly string[]
  readonly globs: readonly string[]
  readonly source: readonly string[]
  readonly server: readonly string[]
}
export type TestPartition = 'source' | 'server'
export function parseCanonicalTestScript(script: string): CanonicalTestPlan {
  const [command, ...tokens] = tokenize(script)
  if (command !== 'node') throw new Error('Canonical test command must begin with node.')
  const flags: string[] = []
  const globs: string[] = []
  let readingGlobs = false
  for (const token of tokens) {
    if (token.startsWith('--')) {
      if (readingGlobs) throw new Error(`Test flag appears after a glob: ${token}`)
      if (![...REQUIRED_FLAGS, OPTIONAL_REPORTER].includes(token)) throw new Error(`Unsupported canonical test flag: ${token}`)
      if (flags.includes(token)) throw new Error(`Duplicate canonical test flag: ${token}`)
      flags.push(token)
    } else {
      readingGlobs = true
      if (!safeGlob(token)) throw new Error(`Unsupported canonical test token or glob: ${token}`)
      if (globs.includes(token)) throw new Error(`Duplicate canonical test glob: ${token}`)
      globs.push(token)
    }
  }
  if (REQUIRED_FLAGS.some(flag => !flags.includes(flag))) {
    throw new Error('Canonical test command is missing a required Node test flag.')
  }
  if (!globs.length) throw new Error('Canonical test command has no test globs.')
  const source = globs.filter(glob => glob.startsWith('src/') || glob.startsWith('scripts/'))
  const server = globs.filter(glob => glob.startsWith('server/'))
  if (!source.length || !server.length) throw new Error('Canonical test command must retain both source/scripts and server partitions.')
  return Object.freeze({ flags: Object.freeze(flags), globs: Object.freeze(globs), source: Object.freeze(source), server: Object.freeze(server) })
}

export function partitionArgs(parsed: CanonicalTestPlan, partition: TestPartition): string[] {
  if (partition !== 'source' && partition !== 'server') throw new Error('Partition must be source or server.')
  if (!parsed || !Array.isArray(parsed.flags) || !Array.isArray(parsed[partition]) || !parsed[partition].length) {
    throw new Error('Invalid or empty canonical test partition.')
  }
  const flags = [...parsed.flags]
  if (!flags.includes(OPTIONAL_REPORTER)) flags.push(OPTIONAL_REPORTER)
  return [...flags, ...parsed[partition]]
}

export function parsePartitionArgument(argv: string[]): TestPartition {
  if (!Array.isArray(argv) || argv.length !== 1 || (argv[0] !== 'source' && argv[0] !== 'server')) {
    throw new Error('Usage: node --experimental-strip-types scripts/run-node-suite.ts source|server')
  }
  return argv[0]
}

export function canonicalTestScript(root = ROOT): string {
  const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const script = packageJson?.scripts?.test
  if (typeof script !== 'string') throw new Error('package.json must define the canonical scripts.test command.')
  return script
}

/** Spawn exactly one partition with Node, no shell expansion or command interpolation. */
export interface PartitionChild {
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  kill(signal: NodeJS.Signals): boolean
}
export interface PartitionSignals {
  on(event: NodeJS.Signals, listener: () => void): unknown
  removeListener(event: NodeJS.Signals, listener: () => void): unknown
}
export interface PartitionSpawnOptions { cwd: string; shell: false; stdio: 'inherit' }
export type PartitionSpawner = (executable: string, args: string[], options: PartitionSpawnOptions) => PartitionChild
interface PartitionOptions { script?: string; spawnProcess?: PartitionSpawner; cwd?: string; signalSource?: PartitionSignals }
export function runPartition(partition: TestPartition, { script = canonicalTestScript(), spawnProcess = spawn, cwd = ROOT, signalSource = process }: PartitionOptions = {}): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const parsed = parseCanonicalTestScript(script)
  const args = partitionArgs(parsed, partition)
  return new Promise((resolveResult, reject) => {
    let child: PartitionChild
    try { child = spawnProcess(process.execPath, args, { cwd, shell: false, stdio: 'inherit' }) }
    catch (error) { reject(error); return }
    let requestedSignal: NodeJS.Signals | null = null
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP']
    const handlers = new Map<NodeJS.Signals, () => void>(signals.map(signal => [signal, () => {
      requestedSignal ??= signal
      child.kill(signal)
    }]))
    const cleanup = () => {
      for (const [signal, handler] of handlers) signalSource.removeListener(signal, handler)
    }
    for (const [signal, handler] of handlers) signalSource.on(signal, handler)
    child.once('error', error => { cleanup(); reject(error) })
    child.once('close', (code, signal) => {
      cleanup()
      // A child that handles cancellation and exits zero must not turn a cancelled job green.
      resolveResult({ code, signal: signal ?? requestedSignal })
    })
  })
}

async function cli() {
  let partition: TestPartition
  try { partition = parsePartitionArgument(process.argv.slice(2)) }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Invalid runner arguments.'}\n`); process.exitCode = 2; return }
  try {
    const result = await runPartition(partition)
    if (result.signal) process.kill(process.pid, result.signal)
    else process.exitCode = typeof result.code === 'number' && Number.isInteger(result.code) ? result.code : 1
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Node test partition failed to start.'}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void cli()
