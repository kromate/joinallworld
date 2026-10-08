import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./agent-slot.ts', import.meta.url))
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

interface Run { child: ReturnType<typeof spawn>; done: Promise<{ code: number | null; stdout: string; stderr: string }> }

let dir = ''
const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...process.env, AGENT_SLOT_DIR: dir, AGENT_SLOT_POLL_MS: '30', AGENT_SLOT_HELD: '', ...extra })

function slot(args: string[], extra: Record<string, string> = {}): Run {
  const child = spawn(process.execPath, ['--experimental-strip-types', script, ...args], { env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += chunk })
  child.stderr?.on('data', (chunk) => { stderr += chunk })
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => child.on('close', (code) => resolve({ code, stdout, stderr })))
  return { child, done }
}

/** A command that stays up until the given file exists. */
const holdUntil = (file: string): string[] => ['node', '-e', 'const f=process.argv[1];const t=setInterval(()=>{if(require("fs").existsSync(f)){clearInterval(t)}},20)', file]

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return
    await sleep(25)
  }
  assert.fail(`timed out waiting for ${what}`)
}

const locks = (kind: string): string[] => (existsSync(join(dir, kind)) ? readdirSync(join(dir, kind)).filter((name) => name.endsWith('.lock')) : [])

describe('agent-slot', () => {
  before(() => { dir = mkdtempSync(join(tmpdir(), 'agent-slot-test-')) })
  after(() => { rmSync(dir, { recursive: true, force: true }) })

  it('holds a numbered lock while the command runs and removes it afterwards', async () => {
    const check = 'const fs=require("fs");const d=process.env.AGENT_SLOT_DIR+"/heavy";const f=fs.readdirSync(d).filter(n=>n.endsWith(".lock"));const i=JSON.parse(fs.readFileSync(d+"/"+f[0],"utf8"));console.log(JSON.stringify({files:f,pid:typeof i.pid,host:typeof i.host,cwd:i.cwd,command:i.command,startedAt:typeof i.startedAt}))'
    const result = await slot(['heavy', '--', 'node', '-e', check]).done
    assert.equal(result.code, 0, result.stderr)
    const seen = JSON.parse(result.stdout) as { files: string[]; pid: string; host: string; cwd: string; command: string; startedAt: string }
    assert.deepEqual(seen.files, ['1.lock'])
    assert.deepEqual([seen.pid, seen.host, seen.startedAt], ['number', 'string', 'string'])
    assert.equal(seen.cwd, process.cwd())
    assert.match(seen.command, /^node -e /)
    assert.deepEqual(locks('heavy'), [])
  })

  it('makes a second holder wait when the limit is 1, then lets it in once the first is done', async () => {
    const release = join(dir, 'release-1')
    const first = slot(['heavy', '--', ...holdUntil(release)], { AGENT_SLOT_HEAVY: '1' })
    await until(() => locks('heavy').length === 1, 'the first holder to take the slot')

    const impatient = await slot(['heavy', '--wait-ms', '250', '--', 'node', '-e', 'console.log("ran")'], { AGENT_SLOT_HEAVY: '1' }).done
    assert.equal(impatient.code, 75)
    assert.equal(impatient.stdout, '')
    assert.match(impatient.stderr, /waiting for heavy slot \(1\/1 busy: pid \d+ in .+: node -e/)

    const patient = slot(['heavy', '--', 'node', '-e', 'console.log("ran")'], { AGENT_SLOT_HEAVY: '1' })
    await sleep(300)
    writeFileSync(release, '')
    const [firstResult, patientResult] = await Promise.all([first.done, patient.done])
    assert.equal(firstResult.code, 0)
    assert.equal(patientResult.code, 0, patientResult.stderr)
    assert.equal(patientResult.stdout.trim(), 'ran')
    assert.match(patientResult.stderr, /waiting for heavy slot/)
    assert.deepEqual(locks('heavy'), [])
  })

  it('waits for a live higher-numbered legacy slot before admitting work at the new default limit', async () => {
    const release = join(dir, 'release-high-slot')
    const admitted = join(dir, 'admitted-after-high-slot')
    mkdirSync(join(dir, 'heavy'), { recursive: true })
    const lowSentinel = join(dir, 'heavy', '1.lock')
    writeFileSync(lowSentinel, JSON.stringify({ token: 'test-sentinel', pid: process.pid, host: 'here', cwd: process.cwd(), command: 'test sentinel', kind: 'heavy', startedAt: new Date().toISOString() }))
    const legacy = slot(['heavy', '--', ...holdUntil(release)], { AGENT_SLOT_HEAVY: '2' })
    await until(() => existsSync(join(dir, 'heavy', '2.lock')), 'a legacy two-slot holder to acquire slot 2')
    rmSync(lowSentinel)

    const waiting = slot(['heavy', '--wait-ms', '4000', '--', 'node', '-e', `require('fs').writeFileSync(${JSON.stringify(admitted)},'ran')`])
    await sleep(180)
    assert.equal(existsSync(admitted), false, 'the one-slot-default command cannot pass the live slot-2 owner')
    const status = await slot(['status']).done
    assert.equal(status.code, 0, status.stderr)
    assert.match(status.stdout, /heavy: 1\/1 busy/)
    assert.match(status.stdout, /2 {2}pid \d+ in /)
    assert.match(status.stdout, /beyond the current limit/)

    writeFileSync(release, '')
    const [legacyResult, waitingResult] = await Promise.all([legacy.done, waiting.done])
    assert.equal(legacyResult.code, 0, legacyResult.stderr)
    assert.equal(waitingResult.code, 0, waitingResult.stderr)
    assert.equal(existsSync(admitted), true)
    assert.match(waitingResult.stderr, /higher-numbered slot.*slot 2/)
    assert.deepEqual(locks('heavy'), [])
  })

  it('uses up to the limit at once and no more', async () => {
    const release = join(dir, 'release-2')
    const holders = [1, 2].map(() => slot(['server', '--', ...holdUntil(release)], { AGENT_SLOT_SERVER: '2' }))
    await until(() => locks('server').length === 2, 'both server slots to be taken')
    const third = await slot(['server', '--wait-ms', '150', '--', 'node', '-e', ''], { AGENT_SLOT_SERVER: '2' }).done
    assert.equal(third.code, 75)
    assert.match(third.stderr, /waiting for server slot \(2\/2 busy/)
    writeFileSync(release, '')
    await Promise.all(holders.map((holder) => holder.done))
    assert.deepEqual(locks('server'), [])
  })

  it('reclaims a lock whose owner is gone', async () => {
    const gone = spawn(process.execPath, ['-e', ''])
    await new Promise((resolve) => gone.on('close', resolve))
    mkdirSync(join(dir, 'browser'), { recursive: true })
    const stale = join(dir, 'browser', '1.lock')
    writeFileSync(stale, JSON.stringify({ token: 'old', pid: gone.pid, host: 'elsewhere', cwd: '/nowhere', command: 'dead command', kind: 'browser', startedAt: new Date(0).toISOString() }))
    const result = await slot(['browser', '--wait-ms', '1000', '--', 'node', '-e', 'console.log("ran")']).done
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'ran')
    assert.match(result.stderr, /reclaimed browser slot 1/)
    assert.deepEqual(locks('browser'), [])
  })

  it('reclaims a stale higher-numbered lock before admitting work at limit 1', async () => {
    const gone = spawn(process.execPath, ['-e', ''])
    await new Promise((resolve) => gone.on('close', resolve))
    mkdirSync(join(dir, 'browser'), { recursive: true })
    writeFileSync(join(dir, 'browser', '4.lock'), JSON.stringify({ token: 'old-high', pid: gone.pid, host: 'elsewhere', cwd: '/nowhere', command: 'dead high-slot command', kind: 'browser', startedAt: new Date(0).toISOString() }))
    const completed = await slot(['browser', '--wait-ms', '1000', '--', 'node', '-e', 'console.log("ran")']).done
    assert.equal(completed.code, 0, completed.stderr)
    assert.equal(completed.stdout.trim(), 'ran')
    assert.match(completed.stderr, /reclaimed browser slot 4/)
    assert.deepEqual(locks('browser'), [])
  })

  it('does not reclaim a lock whose owner is alive', async () => {
    mkdirSync(join(dir, 'browser'), { recursive: true })
    writeFileSync(join(dir, 'browser', '1.lock'), JSON.stringify({ token: 'mine', pid: process.pid, host: 'here', cwd: '/here', command: 'live command', kind: 'browser', startedAt: new Date().toISOString() }))
    const result = await slot(['browser', '--wait-ms', '150', '--', 'node', '-e', '']).done
    assert.equal(result.code, 75)
    assert.match(result.stderr, /live command/)
    rmSync(join(dir, 'browser', '1.lock'))
  })

  it('passes the command exit code through, and frees the slot', async () => {
    const result = await slot(['heavy', '--', 'node', '-e', 'process.exit(7)']).done
    assert.equal(result.code, 7)
    assert.deepEqual(locks('heavy'), [])
    const missing = await slot(['heavy', '--', 'definitely-not-a-real-program-xyz']).done
    assert.equal(missing.code, 127)
    assert.deepEqual(locks('heavy'), [])
  })

  it('releases the slot and stops the command when it gets SIGTERM', async () => {
    const never = join(dir, 'never-created')
    const run = slot(['heavy', '--', ...holdUntil(never)])
    await until(() => locks('heavy').length === 1, 'the slot to be taken')
    run.child.kill('SIGTERM')
    const result = await run.done
    assert.notEqual(result.code, 0)
    assert.deepEqual(locks('heavy'), [])
  })

  it('lets a command that asks for the slot kind it already holds run without waiting', async () => {
    const inner = `console.log(require("child_process").spawnSync(process.execPath,["--experimental-strip-types",${JSON.stringify(script)},"heavy","--wait-ms","100","--","node","-e","console.log('inner')"],{encoding:"utf8"}).stdout.trim())`
    const result = await slot(['heavy', '--', 'node', '-e', inner], { AGENT_SLOT_HEAVY: '1' }).done
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout.trim(), 'inner')
  })

  it('lists holders with status', async () => {
    const release = join(dir, 'release-3')
    const holder = slot(['heavy', '--', ...holdUntil(release)])
    await until(() => locks('heavy').length === 1, 'the slot to be taken')
    const result = await slot(['status']).done
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /heavy: 1\/1 busy/)
    assert.match(result.stdout, /server: 0\/1 busy/)
    assert.match(result.stdout, /browser: 0\/1 busy/)
    assert.match(result.stdout, /1 {2}pid \d+ in /)
    writeFileSync(release, '')
    await holder.done
  })

  it('rejects a bad command line', async () => {
    assert.equal((await slot(['nonsense', '--', 'true']).done).code, 2)
    assert.equal((await slot(['heavy']).done).code, 2)
    assert.equal((await slot(['heavy', '--wait-ms', 'soon', '--', 'true']).done).code, 2)
  })
})
