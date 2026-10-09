import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseYaml } from './check-workflows.mjs'
import {
  canonicalTestScript,
  parseCanonicalTestScript,
  parsePartitionArgument,
  partitionArgs,
  runPartition,
  type PartitionSpawnOptions,
  type PartitionSpawner,
} from './run-node-suite.ts'

test('partitions exactly the canonical package test globs without losing JS, TS, or scripts coverage', () => {
  const parsed = parseCanonicalTestScript(canonicalTestScript())
  const combined = [...parsed.source, ...parsed.server]

  assert.deepEqual(new Set(combined), new Set(parsed.globs))
  assert.equal(combined.length, parsed.globs.length)
  assert.ok(parsed.source.some(glob => glob.startsWith('src/') && glob.endsWith('.test.js')))
  assert.ok(parsed.source.some(glob => glob.startsWith('src/') && glob.endsWith('.test.ts')))
  assert.ok(parsed.source.some(glob => glob.startsWith('scripts/') && glob.endsWith('.test.ts')))
  assert.ok(parsed.server.some(glob => glob.endsWith('.test.js')))
  assert.ok(parsed.server.some(glob => glob.endsWith('.test.ts')))
  assert.deepEqual(parsed.flags.slice(0, 3), [
    '--experimental-strip-types',
    '--test',
    '--test-concurrency=1',
  ])
})

test('fails closed for malformed commands, unknown flags/globs, and a missing partition', () => {
  const canonical = canonicalTestScript()
  assert.throws(() => parseCanonicalTestScript(canonical.replace('"server/**/*.test.js"', '"server/**/*.test.js')), /token boundary/)
  assert.throws(() => parseCanonicalTestScript(`${canonical} "deploy/**/*.test.ts"`), /Unsupported/)
  assert.throws(() => parseCanonicalTestScript(canonical.replace('--test-concurrency=1', '--inspect')), /Unsupported/)
  assert.throws(() => parseCanonicalTestScript(canonical.replace('"server/**/*.test.js" "server/**/*.test.ts"', '')), /both source\/scripts and server/)
  assert.throws(() => parseCanonicalTestScript(canonical.replace('--test --test-concurrency=1', '--test-concurrency=1')), /required Node test flag/)
  assert.throws(() => parseCanonicalTestScript(canonical.replace('"src/**/*.test.js"', '"src/**/*.test.js')), /token boundary/)
  assert.throws(() => parseCanonicalTestScript(canonical.slice(0, -1)), /Malformed/)
  assert.throws(() => parseCanonicalTestScript(`${canonical} && node other.js`), /Unsupported shell syntax/)
})

test('partition arguments preserve canonical flags and select only the requested complete partition', () => {
  const parsed = parseCanonicalTestScript(canonicalTestScript())
  const source = partitionArgs(parsed, 'source')
  const server = partitionArgs(parsed, 'server')

  assert.deepEqual(source.slice(0, parsed.flags.length), parsed.flags)
  assert.deepEqual(source.slice(parsed.flags.length + 1), parsed.source)
  assert.equal(source[parsed.flags.length], '--test-reporter=spec')
  assert.deepEqual(server.slice(parsed.flags.length + 1), parsed.server)
  assert.equal(server[parsed.flags.length], '--test-reporter=spec')
  assert.equal(parsePartitionArgument(['source']), 'source')
  assert.equal(parsePartitionArgument(['server']), 'server')
  assert.throws(() => parsePartitionArgument([]), /Usage/)
  assert.throws(() => parsePartitionArgument(['source', 'server']), /Usage/)
})

test('spawns Node with shell disabled and returns the child exit result unchanged', async () => {
  const calls: Array<{ executable: string; args: string[]; options: PartitionSpawnOptions }> = []
  const spawnStub: PartitionSpawner = (executable, args, options) => {
    calls.push({ executable, args, options })
    const child = Object.assign(new EventEmitter(), { kill: (_signal: NodeJS.Signals) => true })
    queueMicrotask(() => child.emit('close', 17, null))
    return child
  }
  const result = await runPartition('source', {
    script: canonicalTestScript(),
    spawnProcess: spawnStub,
    cwd: '/fixture/worktree',
  })

  const captured = calls[0]
  assert.ok(captured)
  assert.equal(captured.executable, process.execPath)
  assert.equal(captured.options.cwd, '/fixture/worktree')
  assert.equal(captured.options.shell, false)
  assert.deepEqual(captured.options.stdio, 'inherit')
  assert.ok(captured.args.includes('--test-reporter=spec'))
  assert.deepEqual(result, { code: 17, signal: null })
})

test('propagates a child signal result without starting or signaling a real process', async () => {
  const spawnStub = () => {
    const child = Object.assign(new EventEmitter(), { kill: (_signal: NodeJS.Signals) => true })
    queueMicrotask(() => child.emit('close', null, 'SIGTERM'))
    return child
  }
  assert.deepEqual(await runPartition('server', {
    script: canonicalTestScript(),
    spawnProcess: spawnStub,
  }), { code: null, signal: 'SIGTERM' })
})

test('forwards parent cancellation, refuses a green cancellation, and removes listeners', async () => {
  const signalSource = new EventEmitter()
  const signals: NodeJS.Signals[] = []
  const child = Object.assign(new EventEmitter(), { kill: (signal: NodeJS.Signals) => { signals.push(signal); return true } })
  const pending = runPartition('source', { spawnProcess: () => child, signalSource })
  signalSource.emit('SIGTERM')
  assert.deepEqual(signals, ['SIGTERM'])
  child.emit('close', 0, null)
  assert.deepEqual(await pending, { code: 0, signal: 'SIGTERM' })
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(signalSource.listenerCount(signal), 0)
})

test('spawn errors reject and remove parent signal listeners', async () => {
  const signalSource = new EventEmitter()
  const child = Object.assign(new EventEmitter(), { kill: (_signal: NodeJS.Signals) => true })
  const pending = runPartition('server', { spawnProcess: () => child, signalSource })
  const error = new Error('fixture spawn failure')
  child.emit('error', error)
  await assert.rejects(pending, error)
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(signalSource.listenerCount(signal), 0)
})

interface SuiteJob {
  needs?: string
  if: string
  'timeout-minutes': number
  'continue-on-error'?: unknown
  strategy: { matrix: { node: number[] }; 'fail-fast': boolean; 'max-parallel': number }
  steps: Array<{ run?: string; 'continue-on-error'?: unknown }>
}
test('full CI requires both exhaustive partitions and Worker coverage in bounded successive waves', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  // These three jobs use the supported plain-map YAML subset; other existing jobs use folded scalars.
  const start = workflow.indexOf('\n  full:\n'), end = workflow.indexOf('\n  # Focused evidence', start)
  assert.ok(start >= 0 && end > start)
  const { jobs } = parseYaml(`jobs:${workflow.slice(start, end)}`) as { jobs: Record<string, SuiteJob> }
  assert.deepEqual(Object.keys(jobs), ['full', 'full-server', 'full-worker'])
  const server = jobs['full-server'], worker = jobs['full-worker']
  assert.ok(server && worker)
  assert.equal(server.needs, 'full')
  assert.equal(worker.needs, 'full-server')
  for (const job of Object.values(jobs)) {
    assert.equal(job.if, "github.event_name == 'workflow_dispatch' && inputs.full_checks && !inputs.focused_living_world")
    assert.equal(job['timeout-minutes'], 25)
    assert.deepEqual(job.strategy.matrix.node, [22, 24])
    assert.equal(job.strategy['fail-fast'], false)
    assert.equal(job.strategy['max-parallel'], 2)
    assert.equal(job['continue-on-error'], undefined)
    const commands = job.steps.map(step => step.run).filter((command): command is string => typeof command === 'string')
    const testIndex = commands.findIndex((command: string) => command.startsWith('node --experimental-strip-types scripts/run-node-suite.ts') || command === 'npm run test:edge')
    assert.ok(commands.indexOf('npm run build') < testIndex)
    assert.ok(commands.indexOf('npm run size:download') < testIndex)
    assert.ok(commands.includes('npm run build') && commands.includes('npm run size:download'))
    assert.ok(job.steps.every(step => step['continue-on-error'] === undefined))
  }
  for (const [id, partition] of [['full', 'source'], ['full-server', 'server']]) {
    const job = jobs[id as string]
    assert.ok(job)
    const commands = job.steps.map(step => step.run).filter((command): command is string => typeof command === 'string')
    assert.ok(commands.includes('npm run -s pretest'))
    assert.equal(commands.at(-1), `node --experimental-strip-types scripts/run-node-suite.ts ${partition}`)
  }
  assert.equal(worker.steps.at(-1)?.run, 'npm run test:edge')
})
