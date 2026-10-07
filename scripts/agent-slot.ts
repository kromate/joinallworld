// Machine-wide "slots": run a memory-heavy command only when fewer than N such commands are already
// running on this machine, across every git worktree of this repository.
//
//   node --experimental-strip-types scripts/agent-slot.ts <heavy|server|browser> [--wait-ms N] -- <command...>
//   node --experimental-strip-types scripts/agent-slot.ts status
//
// Limits: heavy 3, server 2, browser 1 (override with AGENT_SLOT_HEAVY / AGENT_SLOT_SERVER /
// AGENT_SLOT_BROWSER). Locks are files in `$(git rev-parse --git-common-dir)/agent-slots/<kind>/<n>.lock`,
// which every worktree of the repository shares. AGENT_SLOT_DIR replaces that directory (the tests use it).
// AGENT_SLOT_POLL_MS sets how often a waiting command looks for a free slot (default 1000).
//
// A lock is created whole (written to a temporary file, then hard-linked into place), so a reader never
// sees half of one. It is stale when the process that wrote it is gone, and the next caller reclaims it.
// The command inherits stdio, its exit code is ours, and the slot is released when it ends or when this
// process gets SIGINT, SIGTERM or SIGHUP (the signal is passed on to the command first). A command that
// itself asks for a kind of slot this process already holds runs without asking again.
// Exit codes: the command's own; 2 for a usage error; 75 when --wait-ms ran out before a slot freed up.
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { constants as osConstants, hostname } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULT_LIMITS = { heavy: 3, server: 2, browser: 1 } as const
type Kind = keyof typeof DEFAULT_LIMITS
const KINDS = Object.keys(DEFAULT_LIMITS) as Kind[]
const isKind = (value: string): value is Kind => (KINDS as string[]).includes(value)

const EXIT_USAGE = 2
const EXIT_WAIT_TIMEOUT = 75
const HELD_ENV = 'AGENT_SLOT_HELD'
const CORRUPT_LOCK_GRACE_MS = 5_000
const RECLAIM_GUARD_GRACE_MS = 10_000

interface LockInfo { token: string; pid: number; host: string; cwd: string; command: string; kind: string; startedAt: string }
interface HeldSlot { kind: Kind; number: number; file: string; token: string }

const usage = `Usage: node --experimental-strip-types scripts/agent-slot.ts <heavy|server|browser> [--wait-ms N] -- <command...>
       node --experimental-strip-types scripts/agent-slot.ts status`

function fail(message: string, code = EXIT_USAGE): never {
  process.stderr.write(`agent-slot: ${message}\n`)
  process.exit(code)
}

export function limitFor(kind: Kind, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[`AGENT_SLOT_${kind.toUpperCase()}`]
  if (raw === undefined || raw === '') return DEFAULT_LIMITS[kind]
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) fail(`AGENT_SLOT_${kind.toUpperCase()} must be a whole number of 1 or more (got "${raw}")`)
  return parsed
}

function slotRoot(): string {
  const override = process.env.AGENT_SLOT_DIR
  if (override) return resolve(override)
  let common: string
  try {
    common = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return fail('this is not a git checkout, so there is no shared git directory for the locks (set AGENT_SLOT_DIR to choose one)')
  }
  return join(resolve(process.cwd(), common), 'agent-slots')
}

const isCode = (error: unknown, code: string): boolean => typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isCode(error, 'EPERM')
  }
}

type LockRead = { state: 'free' } | { state: 'held'; info: LockInfo } | { state: 'corrupt'; ageMs: number }

function readLock(file: string): LockRead {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (isCode(error, 'ENOENT')) return { state: 'free' }
    throw error
  }
  try {
    const info = JSON.parse(text) as Partial<LockInfo>
    if (typeof info.pid === 'number' && typeof info.token === 'string') {
      return { state: 'held', info: { token: info.token, pid: info.pid, host: String(info.host ?? ''), cwd: String(info.cwd ?? ''), command: String(info.command ?? ''), kind: String(info.kind ?? ''), startedAt: String(info.startedAt ?? '') } }
    }
  } catch {
    // fall through to corrupt
  }
  let ageMs = 0
  try {
    ageMs = Date.now() - statSync(file).mtimeMs
  } catch {
    return { state: 'free' }
  }
  return { state: 'corrupt', ageMs }
}

/** The host is recorded for people reading the lock; liveness is judged by pid because the git directory is local. */
const isStale = (lock: LockRead): boolean => (lock.state === 'held' ? !isAlive(lock.info.pid) : lock.state === 'corrupt' && lock.ageMs > CORRUPT_LOCK_GRACE_MS)

function tryCreate(file: string, info: LockInfo): boolean {
  const tmp = `${file}.${process.pid}.${info.token}.tmp`
  writeFileSync(tmp, `${JSON.stringify(info)}\n`)
  try {
    linkSync(tmp, file)
    return true
  } catch (error) {
    if (isCode(error, 'EEXIST')) return false
    throw error
  } finally {
    rmSync(tmp, { force: true })
  }
}

/** Removes the lock when its owner is gone. A guard directory keeps two reclaimers from deleting a lock the other just took. */
function reclaimIfStale(file: string): LockInfo | 'corrupt' | undefined {
  const guard = `${file}.reclaim`
  try {
    mkdirSync(guard)
  } catch (error) {
    if (!isCode(error, 'EEXIST')) throw error
    try {
      if (Date.now() - statSync(guard).mtimeMs > RECLAIM_GUARD_GRACE_MS) rmSync(guard, { recursive: true, force: true })
    } catch {
      // the other reclaimer just finished
    }
    return undefined
  }
  try {
    const current = readLock(file)
    if (!isStale(current)) return undefined
    unlinkSync(file)
    return current.state === 'held' ? current.info : 'corrupt'
  } finally {
    rmSync(guard, { recursive: true, force: true })
  }
}

function release(slot: HeldSlot | undefined): void {
  if (!slot) return
  const current = readLock(slot.file)
  if (current.state === 'held' && current.info.token === slot.token) rmSync(slot.file, { force: true })
}

const ago = (startedAt: string): string => {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000))
  if (!Number.isFinite(seconds)) return '?'
  return seconds < 90 ? `${seconds}s` : seconds < 5400 ? `${Math.round(seconds / 60)}m` : `${Math.round(seconds / 3600)}h`
}
const describe = (info: LockInfo): string => `pid ${info.pid} in ${info.cwd}: ${info.command} (${ago(info.startedAt)})`

function status(): void {
  const root = slotRoot()
  for (const kind of KINDS) {
    const limit = limitFor(kind)
    const dir = join(root, kind)
    let highest = limit
    let files: string[] = []
    try {
      files = readdirSync(dir)
    } catch {
      // nothing has used this kind yet
    }
    for (const name of files) {
      const match = /^(\d+)\.lock$/.exec(name)
      if (match) highest = Math.max(highest, Number(match[1]))
    }
    const lines: string[] = []
    let busy = 0
    for (let number = 1; number <= highest; number += 1) {
      const lock = readLock(join(dir, `${number}.lock`))
      const beyond = number > limit ? ' (beyond the current limit)' : ''
      if (lock.state === 'free') {
        if (number <= limit) lines.push(`  ${number}  free`)
      } else if (isStale(lock)) {
        lines.push(`  ${number}  stale, will be reclaimed${lock.state === 'held' ? `: ${describe(lock.info)}` : ''}${beyond}`)
      } else {
        if (number <= limit) busy += 1
        lines.push(`  ${number}  ${lock.state === 'held' ? describe(lock.info) : 'being written'}${beyond}`)
      }
    }
    process.stdout.write(`${kind}: ${busy}/${limit} busy\n${lines.join('\n')}\n`)
  }
}

interface Parsed { kind: Kind; waitMs: number | undefined; command: string[] }

function parse(argv: string[]): Parsed | 'status' {
  const [first, ...rest] = argv
  if (first === 'status' && rest.length === 0) return 'status'
  if (first === undefined || !isKind(first)) return fail(`expected one of ${KINDS.join(', ')} or status\n${usage}`)
  let waitMs: number | undefined
  let index = 0
  while (index < rest.length && rest[index] !== '--') {
    const option = rest[index]
    if (option === '--wait-ms') {
      const value = Number(rest[index + 1])
      if (!Number.isFinite(value) || value < 0) return fail(`--wait-ms needs a number of milliseconds\n${usage}`)
      waitMs = value
      index += 2
    } else {
      return fail(`unknown option ${option}\n${usage}`)
    }
  }
  const command = rest.slice(index + 1)
  if (rest[index] !== '--' || command.length === 0) return fail(`give the command after --\n${usage}`)
  return { kind: first, waitMs, command }
}

async function acquire(kind: Kind, limit: number, waitMs: number | undefined, command: string[]): Promise<HeldSlot | undefined> {
  const dir = join(slotRoot(), kind)
  mkdirSync(dir, { recursive: true })
  const info: LockInfo = { token: randomBytes(8).toString('hex'), pid: process.pid, host: hostname(), cwd: process.cwd(), command: command.join(' '), kind, startedAt: new Date().toISOString() }
  const pollMs = Math.max(10, Number(process.env.AGENT_SLOT_POLL_MS) || 1000)
  const deadline = waitMs === undefined ? Infinity : Date.now() + waitMs
  let lastAnnounced = ''
  for (;;) {
    const holders: string[] = []
    for (let number = 1; number <= limit; number += 1) {
      const file = join(dir, `${number}.lock`)
      const held: HeldSlot = { kind, number, file, token: info.token }
      if (tryCreate(file, info)) return held
      const reclaimed = reclaimIfStale(file)
      if (reclaimed) {
        process.stderr.write(`agent-slot: reclaimed ${kind} slot ${number} from a process that is gone${reclaimed === 'corrupt' ? '' : ` (pid ${reclaimed.pid}: ${reclaimed.command})`}\n`)
        if (tryCreate(file, info)) return held
      }
      const lock = readLock(file)
      holders.push(lock.state === 'held' ? describe(lock.info) : lock.state === 'corrupt' ? 'a lock being written' : 'just freed')
    }
    const announcement = `agent-slot: waiting for ${kind} slot (${holders.length}/${limit} busy: ${holders.join('; ')})`
    if (announcement !== lastAnnounced) process.stderr.write(`${announcement}\n`)
    lastAnnounced = announcement
    if (Date.now() >= deadline) return undefined
    await sleep(Math.min(pollMs, Math.max(10, deadline - Date.now())))
  }
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  const number = signal ? osConstants.signals[signal] : undefined
  return 128 + (number ?? 1)
}

async function main(): Promise<void> {
  const parsed = parse(process.argv.slice(2))
  if (parsed === 'status') return status()
  const { kind, waitMs, command } = parsed
  const alreadyHeld = (process.env[HELD_ENV] ?? '').split(',').filter(Boolean)
  let slot: HeldSlot | undefined
  let child: ReturnType<typeof spawn> | undefined
  let interrupted: NodeJS.Signals | undefined
  const onSignal = (signal: NodeJS.Signals): void => {
    interrupted = signal
    if (child) {
      child.kill(signal)
      return
    }
    release(slot)
    process.exit(signalExitCode(signal))
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => onSignal(signal))
  process.on('exit', () => release(slot))

  if (!alreadyHeld.includes(kind)) {
    slot = await acquire(kind, limitFor(kind), waitMs, command)
    if (!slot) return fail(`gave up waiting for a ${kind} slot after ${waitMs} ms`, EXIT_WAIT_TIMEOUT)
  }
  const [program, ...args] = command as [string, ...string[]]
  const env = slot ? { ...process.env, [HELD_ENV]: [...alreadyHeld, kind].join(',') } : process.env
  child = spawn(program, args, { stdio: 'inherit', env })
  child.on('error', (error) => {
    release(slot)
    fail(`could not start ${program}: ${error.message}`, 127)
  })
  child.on('close', (code, signal) => {
    release(slot)
    process.exit(code ?? signalExitCode(signal ?? interrupted ?? null))
  })
}

if (import.meta.main) await main()
