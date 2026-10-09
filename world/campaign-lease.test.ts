import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { campaignLeaseWorkerStdio, openCampaignLease, type CampaignLeaseConfiguration } from './campaign-lease.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(HERE, 'tooling', 'index_writer_lock.py');
const PYTHON = process.env.WORLD_TEST_PYTHON;
const workerSource = `import os,time\nos.fstat(6)\nos.write(1,b'world-campaign-worker-ready-v1\\n')\ntime.sleep(float(os.environ['LEASE_TEST_SECONDS']))\n`;
const CLOSES = new WeakMap<ChildProcess, Promise<[number | null, NodeJS.Signals | null]>>();

async function pinFile(filename: string) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) { bytes += chunk.length; hash.update(chunk); }
  return { bytes, sha256: hash.digest('hex') };
}

async function pythonPath(): Promise<string> {
  const candidate = PYTHON ?? (existsSync('/usr/bin/python3') ? '/usr/bin/python3' : execFileSync('which', ['python3'], { encoding: 'utf8' }).trim());
  return realpath(candidate);
}

async function configFor(executableValue?: string): Promise<CampaignLeaseConfiguration> {
  const executable = executableValue ?? await pythonPath();
  const [python, helper] = await Promise.all([pinFile(executable), pinFile(HELPER)]);
  return { pythonExecutable: executable, pythonBytes: python.bytes, pythonSha256: python.sha256,
    helperBytes: helper.bytes, helperSha256: helper.sha256 };
}

async function privateRoot(): Promise<string> {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'campaign-lease-test-'));
  await chmod(root, 0o700);
  return realpath(root);
}

async function runWorker(root: string, lease: Awaited<ReturnType<typeof openCampaignLease>>, python: string,
                         seconds = 0.8): Promise<ChildProcess> {
  const filename = path.join(root, 'lease-worker.py');
  await writeFile(filename, workerSource, { flag: 'wx', mode: 0o600 });
  const stdio = await campaignLeaseWorkerStdio(lease, ['ignore', 'pipe', 'pipe']);
  const child = spawn(python, ['-I', '-B', filename], {
    cwd: root, shell: false, detached: true, stdio,
    env: { PATH: path.dirname(python), LEASE_TEST_SECONDS: String(seconds) },
  });
  CLOSES.set(child, once(child, 'close') as Promise<[number | null, NodeJS.Signals | null]>);
  return child;
}

async function waitWorkerReady(child: ChildProcess): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const ready = await Promise.race([
      once(child.stdout!, 'data') as Promise<[Buffer]>,
      CLOSES.get(child)!.then(() => { throw new Error('worker exited before readiness'); }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('worker readiness exceeded its deadline')), 3000);
      }),
    ]);
    assert.equal(ready[0].toString('utf8'), 'world-campaign-worker-ready-v1\n');
  } finally { if (timer) clearTimeout(timer); }
}

async function expectBusy(root: string, config: CampaignLeaseConfiguration): Promise<void> {
  await assert.rejects(openCampaignLease(root, config), /campaign lease helper exited without success/);
}

async function waitChild(child: ChildProcess): Promise<void> {
  const [code, signal] = await CLOSES.get(child)!;
  assert.equal(code, 0);
  assert.equal(signal, null);
}

function processState(pid: number): string | null | undefined {
  if (!Number.isSafeInteger(pid) || pid < 1) return undefined;
  try {
    return execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 250, maxBuffer: 128, killSignal: 'SIGKILL',
    }).trim() || null;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { status?: number; signal?: string; stdout?: string | Buffer };
    return failure.status === 1 && !failure.signal && !String(failure.stdout ?? '') ? null : undefined;
  }
}

async function waitProcessTerminal(pid: number, durationMs: number): Promise<boolean> {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    const state = processState(pid);
    if (state === null || (state !== undefined && state.startsWith('Z'))) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

test('campaign lease opens the fixed helper and preserves the permanent inode on reacquisition', async () => {
  const root = await privateRoot();
  try {
    const config = await configFor();
    const first = await openCampaignLease(root, config);
    const identity = first.lockIdentity;
    await first.assertIdentity();
    await first.close();
    const second = await openCampaignLease(root, config);
    assert.deepEqual(second.lockIdentity, identity);
    await second.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('an inherited worker reference keeps the OFD locked after the coordinator closes', async () => {
  const root = await privateRoot();
  let worker: ChildProcess | undefined;
  let workerTerminal = true;
  try {
    const config = await configFor();
    const python = config.pythonExecutable;
    const lease = await openCampaignLease(root, config);
    const identity = lease.lockIdentity;
    worker = await runWorker(root, lease, python, 4);
    workerTerminal = false;
    await waitWorkerReady(worker);
    await lease.close();
    await expectBusy(root, config);
    await waitChild(worker);
    workerTerminal = true;
    const recovered = await openCampaignLease(root, config);
    assert.deepEqual(recovered.lockIdentity, identity);
    await recovered.close();
  } finally {
    if (worker && !workerTerminal) {
      if (worker.pid) { try { process.kill(-worker.pid, 'SIGKILL'); } catch { /* Already terminal. */ } }
      workerTerminal = worker.pid ? await waitProcessTerminal(worker.pid, 3000) : false;
    }
    if (workerTerminal) await rm(root, { recursive: true, force: true });
  }
});

test('a Node coordinator SIGKILL cannot release a surviving worker inherited lease', async () => {
  const root = await privateRoot();
  let workerPid = 0;
  let workerTerminal = false;
  let coordinator: ChildProcess | undefined;
  let coordinatorClosed: Promise<[number | null, NodeJS.Signals | null]> | undefined;
  try {
    const config = await configFor();
    const python = config.pythonExecutable;
    const workerPath = path.join(root, 'lease-survivor.py');
    const coordinatorPath = path.join(root, 'lease-coordinator.mjs');
    await writeFile(workerPath, workerSource, { flag: 'wx', mode: 0o600 });
    const modulePath = new URL('./campaign-lease.ts', import.meta.url).href;
    const source = `import {spawn} from 'node:child_process';\nimport {openCampaignLease,campaignLeaseWorkerStdio} from ${JSON.stringify(modulePath)};\n`
      + `const root=${JSON.stringify(root)}, python=${JSON.stringify(python)}, worker=${JSON.stringify(workerPath)};\n`
      + `const config=${JSON.stringify(config)};\nconst lease=await openCampaignLease(root,config);\n`
      + `const stdio=await campaignLeaseWorkerStdio(lease,['ignore','pipe','ignore']);\n`
      + `const child=spawn(python,['-I','-B',worker],{cwd:root,shell:false,detached:true,stdio,env:{PATH:${JSON.stringify(path.dirname(python))},LEASE_TEST_SECONDS:'5'}});\n`
      + `const [ready]=await import('node:events').then(({once})=>once(child.stdout,'data'));\n`
      + `if(ready.toString('utf8')!=='world-campaign-worker-ready-v1\\n')throw Error('worker did not confirm inherited fd');\n`
      + `process.stdout.write(JSON.stringify({pid:child.pid,format:'started'})+'\\n');\nawait new Promise(()=>{});\n`;
    await writeFile(coordinatorPath, source, { flag: 'wx', mode: 0o600 });
    coordinator = spawn(process.execPath, ['--experimental-strip-types', coordinatorPath], {
      cwd: root, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    coordinatorClosed = once(coordinator, 'close') as Promise<[number | null, NodeJS.Signals | null]>;
    const ownedCoordinator = coordinator;
    let stdout = '';
    coordinator.stdout?.setEncoding('utf8');
    coordinator.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    const ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeout: NodeJS.Timeout;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      timeout = setTimeout(() => fail(new Error('coordinator did not launch inherited worker')), 5000);
      ownedCoordinator.stdout?.on('data', () => {
        if (!stdout.includes('\n')) return;
        const line = stdout.split('\n')[0];
        if (!line) return;
        if (settled) return;
        clearTimeout(timeout);
        try {
          const value = JSON.parse(line);
          if (!Number.isSafeInteger(value.pid) || value.pid < 1 || value.format !== 'started') throw new Error('invalid coordinator ready frame');
          workerPid = value.pid;
          settled = true;
          resolve();
        } catch (error) { fail(error instanceof Error ? error : new Error('invalid coordinator ready frame')); }
      });
      ownedCoordinator.once('error', fail);
      ownedCoordinator.once('close', () => fail(new Error('coordinator exited before worker readiness')));
    });
    await ready;
    assert.ok(workerPid > 0);
    process.kill(coordinator.pid!, 'SIGKILL');
    await coordinatorClosed;
    await expectBusy(root, config);
    workerTerminal = await waitProcessTerminal(workerPid, 8000);
    assert.equal(workerTerminal, true, 'surviving worker must reach an actual terminal OS state');
    const recovered = await openCampaignLease(root, config);
    await recovered.close();
  } finally {
    if (coordinator?.pid && processState(coordinator.pid) !== null) {
      try { process.kill(coordinator.pid, 'SIGKILL'); } catch { /* Already terminal. */ }
      await coordinatorClosed?.catch(() => []);
    }
    if (workerPid > 0 && !workerTerminal) {
      try { process.kill(-workerPid, 'SIGKILL'); } catch { /* Already terminal. */ }
      workerTerminal = await waitProcessTerminal(workerPid, 3000);
    }
    const safeToRemove = coordinator === undefined || (workerPid > 0 && workerTerminal);
    if (safeToRemove) await rm(root, { recursive: true, force: true });
  }
});

test('invalid pins and an unsafe pre-existing lock are refused without replacing bytes', async () => {
  const root = await privateRoot();
  try {
    const config = await configFor();
    const invalid = { ...config, helperSha256: '0'.repeat(64) };
    await assert.rejects(openCampaignLease(root, invalid), /SHA-256 pin/);
    await assert.rejects(lstat(path.join(root, 'writer.lock')), { code: 'ENOENT' });
    const lock = path.join(root, 'writer.lock');
    const original = Buffer.from('foreign-lock-content');
    await writeFile(lock, original, { flag: 'wx', mode: 0o600 });
    await assert.rejects(openCampaignLease(root, config), /owned empty 0600/);
    assert.deepEqual(await readFile(lock), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('malformed helper output never yields a lease', async () => {
  const root = await privateRoot();
  const fakePython = path.join(root, 'fake-python');
  try {
    await writeFile(fakePython, '#!/bin/sh\nprintf "not-json\\n"\n', { flag: 'wx', mode: 0o700 });
    await chmod(fakePython, 0o700);
    const config = await configFor(fakePython);
    await assert.rejects(openCampaignLease(root, config), /ready line|exited without success|capture json/i);
    assert.deepEqual(await (await import('node:fs/promises')).readFile(path.join(root, 'writer.lock')), Buffer.alloc(0));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('wall-limit termination reaps the fixed process group before the inode is reacquired', async () => {
  const root = await privateRoot();
  const slowPython = path.join(root, 'slow-python');
  let pids: number[] = [];
  let safeToRemove = false;
  try {
    await writeFile(slowPython, '#!/bin/sh\n/bin/sleep 10 &\nkid=$!\nprintf \'%s\\n%s\\n\' "$$" "$kid" > "$5/timeout-pids"\nwait "$kid"\n', { flag: 'wx', mode: 0o700 });
    await chmod(slowPython, 0o700);
    const actualConfig = await configFor();
    const slowPin = await pinFile(slowPython);
    const config = { ...actualConfig, pythonExecutable: slowPython, pythonBytes: slowPin.bytes, pythonSha256: slowPin.sha256 };
    await assert.rejects(openCampaignLease(root, config, { durationMs: 200 }), /exceeded its wall limit/);
    pids = (await readFile(path.join(root, 'timeout-pids'), 'utf8')).trim().split('\n').map(Number);
    assert.equal(pids.length, 2);
    assert.ok(pids.every(pid => Number.isSafeInteger(pid) && pid > 0));
    const terminal = await Promise.all(pids.map(pid => waitProcessTerminal(pid, 3000)));
    assert.deepEqual(terminal, [true, true]);
    const lockBefore = await lstat(path.join(root, 'writer.lock'), { bigint: true });
    const recovered = await openCampaignLease(root, actualConfig);
    assert.equal(recovered.lockIdentity.device, Number(lockBefore.dev));
    assert.equal(recovered.lockIdentity.inode, Number(lockBefore.ino));
    await recovered.close();
    safeToRemove = true;
  } finally {
    if (pids.length) {
      for (const pid of pids) { if (processState(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already terminal. */ } } }
      const terminal = await Promise.all(pids.map(pid => waitProcessTerminal(pid, 3000)));
      safeToRemove ||= terminal.every(Boolean);
    }
    if (safeToRemove) await rm(root, { recursive: true, force: true });
  }
});
