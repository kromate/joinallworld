import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { campaignLeaseWorkerStdio, openCampaignLease, type CampaignLease, type CampaignLeaseConfiguration } from './campaign-lease.ts';
import { prepareCampaignWorkerLeases } from './campaign-worker-leases.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPER = path.join(HERE, 'tooling', 'index_writer_lock.py');
const PYTHON = process.env.WORLD_TEST_PYTHON;
const READY = 'world-campaign-paired-lease-ready-v1\n';
type StdioEntry = Extract<StdioOptions, unknown[]>[number];
const BASE_STDIO: StdioEntry[] = ['ignore', 'pipe', 'pipe', 'ignore', 'ignore', 'ignore'];
type ChildOutcome = { kind: 'close'; code: number | null; signal: NodeJS.Signals | null }
  | { kind: 'error'; error: Error };
const WORKER_SOURCE = `import json,os,time\nframe=json.loads(os.environ['WORLD_CAMPAIGN_LEASE_FRAME'])\nassert frame['format']=='world-campaign-worker-leases-v1'\nfor role in (frame['campaign'],frame['acquisition']):\n fd=role['descriptor']; info=os.fstat(fd)\n assert (info.st_dev,info.st_ino)==(role['lockDevice'],role['lockInode'])\nos.write(1,b'${READY.replace('\n', '\\n')}')\ntime.sleep(5)\n`;
const CLOSES = new WeakMap<ChildProcess, Promise<ChildOutcome>>();
const RETAINED: CampaignLease[] = [];

async function pinFile(filename: string) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(filename)) { bytes += chunk.length; hash.update(chunk); }
  return { bytes, sha256: hash.digest('hex') };
}
async function pythonPath(): Promise<string> {
  return realpath(PYTHON ?? (existsSync('/usr/bin/python3') ? '/usr/bin/python3' : execFileSync('which', ['python3'], { encoding: 'utf8' }).trim()));
}
async function configFor(): Promise<CampaignLeaseConfiguration> {
  const executable = await pythonPath();
  const [python, helper] = await Promise.all([pinFile(executable), pinFile(HELPER)]);
  return { pythonExecutable: executable, pythonBytes: python.bytes, pythonSha256: python.sha256,
    helperBytes: helper.bytes, helperSha256: helper.sha256 };
}
async function privateRoot(): Promise<string> {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'campaign-pair-test-'));
  await chmod(root, 0o700);
  return realpath(root);
}
async function worker(root: string, options: Awaited<ReturnType<typeof prepareCampaignWorkerLeases>>,
                      python: string): Promise<ChildProcess> {
  const filename = path.join(root, 'paired-lease-worker.py');
  await writeFile(filename, WORKER_SOURCE, { flag: 'wx', mode: 0o600 });
  const child = spawn(python, ['-I', '-B', filename], {
    cwd: root, shell: false, detached: true, stdio: options.stdio, env: options.environment,
  });
  trackChild(child);
  return child;
}

function trackChild(child: ChildProcess): Promise<ChildOutcome> {
  const existing = CLOSES.get(child);
  if (existing) return existing;
  const outcome = new Promise<ChildOutcome>(resolve => {
    let settled = false;
    child.once('error', error => {
      if (settled) return;
      settled = true;
      resolve({ kind: 'error', error });
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ kind: 'close', code, signal });
    });
  });
  CLOSES.set(child, outcome);
  return outcome;
}

async function waitReady(child: ChildProcess): Promise<void> {
  const expected = Buffer.from(READY, 'utf8');
  let received = Buffer.alloc(0);
  let timer: NodeJS.Timeout | undefined;
  let onData: ((chunk: Buffer) => void) | undefined;
  let onError: ((error: Error) => void) | undefined;
  try {
    if (!child.stdout) throw new Error('paired worker has no readiness pipe');
    const ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (onData) child.stdout?.removeListener('data', onData);
        if (onError) child.stdout?.removeListener('error', onError);
        if (error) reject(error); else resolve();
      };
      onData = (chunk: Buffer) => {
        if (received.length + chunk.length > 128) return finish(new Error('paired worker readiness exceeded its byte bound'));
        received = Buffer.concat([received, chunk]);
        const newline = received.indexOf(0x0a);
        if (newline >= 0) {
          if (newline !== expected.length - 1 || received.length !== newline + 1
              || !received.subarray(0, newline + 1).equals(expected)) return finish(new Error('paired worker readiness line is not exact'));
          return finish();
        }
        if (received.length > expected.length || !expected.subarray(0, received.length).equals(received)) {
          return finish(new Error('paired worker readiness is not the exact expected prefix'));
        }
      };
      onError = error => finish(error);
      child.stdout!.on('data', onData);
      child.stdout!.on('error', onError);
      CLOSES.get(child)!.then(outcome => {
        if (outcome.kind === 'error') finish(outcome.error);
        else finish(new Error('paired worker exited before readiness'));
      });
      timer = setTimeout(() => finish(new Error('paired worker readiness deadline elapsed')), 3000);
    });
    await ready;
  } finally {
    if (timer) clearTimeout(timer);
    if (onData) child.stdout?.removeListener('data', onData);
    if (onError) child.stdout?.removeListener('error', onError);
  }
}
async function waitChild(child: ChildProcess, timeoutMs = 8000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const outcome = await Promise.race([
      CLOSES.get(child) ?? trackChild(child),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('paired worker close exceeded its deadline')), timeoutMs); }),
    ]);
    if (outcome.kind === 'error') throw outcome.error;
    assert.equal(outcome.code, 0);
    assert.equal(outcome.signal, null);
  } finally { if (timer) clearTimeout(timer); }
}
async function waitClose(child: ChildProcess, timeoutMs = 3000): Promise<ChildOutcome | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      CLOSES.get(child) ?? trackChild(child),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
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
async function waitTerminal(pid: number, durationMs: number): Promise<boolean> {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    const state = processState(pid);
    if (state === null || (state !== undefined && state.startsWith('Z'))) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}
async function expectBusy(root: string, config: CampaignLeaseConfiguration): Promise<void> {
  await assert.rejects(openCampaignLease(root, config), /campaign lease helper exited without success/);
}

test('campaign and acquisition leases pass their actual same-OFD handles through fd 6 and fd 7', async () => {
  const campaignRoot = await privateRoot();
  const acquisitionRoot = await privateRoot();
  let campaign: CampaignLease | undefined;
  let acquisition: CampaignLease | undefined;
  let child: ChildProcess | undefined;
  let childTerminal = true;
  let safeToRemove = false;
  try {
    const config = await configFor();
    campaign = await openCampaignLease(campaignRoot, config);
    acquisition = await openCampaignLease(acquisitionRoot, config);
    const campaignLock = { ...campaign.lockIdentity };
    const acquisitionLock = { ...acquisition.lockIdentity };
    const options = await prepareCampaignWorkerLeases(campaign, acquisition, BASE_STDIO);
    assert.ok(Object.isFrozen(options) && Object.isFrozen(options.stdio) && Object.isFrozen(options.environment));
    assert.deepEqual(Object.keys(options.environment), ['WORLD_CAMPAIGN_LEASE_FRAME']);
    const frameText = options.environment.WORLD_CAMPAIGN_LEASE_FRAME!;
    const frame = JSON.parse(frameText);
    assert.ok(Buffer.byteLength(frameText, 'utf8') <= 32000);
    assert.equal(frameText, JSON.stringify(Object.fromEntries(Object.keys(frame).sort().map(key => [key,
      key === 'campaign' || key === 'acquisition' ? Object.fromEntries(Object.keys(frame[key]).sort().map(field => [field, frame[key][field]])) : frame[key]]))));
    assert.deepEqual(Object.keys(frame).sort(), ['acquisition', 'campaign', 'format']);
    assert.equal(frame.format, 'world-campaign-worker-leases-v1');
    assert.equal(frame.campaign.descriptor, 6);
    assert.equal(frame.acquisition.descriptor, 7);
    assert.equal(frame.campaign.root, campaignRoot);
    assert.equal(frame.acquisition.root, acquisitionRoot);
    assert.equal(frame.campaign.lockDevice, campaignLock.device);
    assert.equal(frame.campaign.lockInode, campaignLock.inode);
    assert.equal(frame.acquisition.lockDevice, acquisitionLock.device);
    assert.equal(frame.acquisition.lockInode, acquisitionLock.inode);
    assert.equal(options.stdio.length, 8);
    assert.equal(options.stdio[6], (await campaignLeaseWorkerStdio(campaign, BASE_STDIO) as unknown[])[6]);
    assert.equal(options.stdio[7], (await campaignLeaseWorkerStdio(acquisition, BASE_STDIO) as unknown[])[6]);

    child = await worker(campaignRoot, options, config.pythonExecutable);
    childTerminal = false;
    await waitReady(child);
    await campaign.close(); campaign = undefined;
    await acquisition.close(); acquisition = undefined;
    await expectBusy(campaignRoot, config);
    await expectBusy(acquisitionRoot, config);
    await waitChild(child);
    childTerminal = true;
    campaign = await openCampaignLease(campaignRoot, config);
    assert.deepEqual(campaign.lockIdentity, campaignLock);
    acquisition = await openCampaignLease(acquisitionRoot, config);
    assert.deepEqual(acquisition.lockIdentity, acquisitionLock);
    await campaign.close(); campaign = undefined;
    await acquisition.close(); acquisition = undefined;
    safeToRemove = true;
  } finally {
    if (child && !childTerminal) {
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already terminal. */ } }
      childTerminal = child.pid ? await waitTerminal(child.pid, 3000) : false;
    }
    if (!child || childTerminal) {
      let leasesReleased = true;
      for (const lease of [campaign, acquisition]) {
        if (!lease) continue;
        try { await lease.close(); } catch { RETAINED.push(lease); leasesReleased = false; }
      }
      safeToRemove ||= (!child || childTerminal) && leasesReleased;
    } else {
      if (campaign) RETAINED.push(campaign);
      if (acquisition) RETAINED.push(acquisition);
    }
    if (safeToRemove) {
      await rm(campaignRoot, { recursive: true, force: true });
      await rm(acquisitionRoot, { recursive: true, force: true });
    }
  }
});

test('forged handles, same lease roles, sparse/accessor stdio, and descriptor collisions refuse', async () => {
  const root = await privateRoot();
  const secondRoot = await privateRoot();
  let lease: CampaignLease | undefined;
  let secondLease: CampaignLease | undefined;
  try {
    const config = await configFor();
    lease = await openCampaignLease(root, config);
    secondLease = await openCampaignLease(secondRoot, config);
    await assert.rejects(prepareCampaignWorkerLeases({} as CampaignLease, null, BASE_STDIO), /actual campaign lease|privately branded/);
    await assert.rejects(prepareCampaignWorkerLeases(lease, lease, BASE_STDIO), /distinct handles/);
    const sparse = [...BASE_STDIO];
    delete sparse[3];
    await assert.rejects(prepareCampaignWorkerLeases(lease, null, sparse), /exactly slots|dense data/);
    const accessor = [...BASE_STDIO];
    Object.defineProperty(accessor, '2', { enumerable: true, configurable: true, get: () => 'pipe' });
    await assert.rejects(prepareCampaignWorkerLeases(lease, null, accessor), /data slots|accessors/);
    await assert.rejects(prepareCampaignWorkerLeases(lease, null, [...BASE_STDIO, 'ignore']), /exactly slots/);
    const mapped = await campaignLeaseWorkerStdio(lease, BASE_STDIO) as unknown[];
    const collision: StdioEntry[] = [...BASE_STDIO];
    collision[0] = mapped[6] as number;
    await assert.rejects(prepareCampaignWorkerLeases(lease, null, collision), /reuses a source descriptor/);
    const acquisitionMapped = await campaignLeaseWorkerStdio(secondLease, BASE_STDIO) as unknown[];
    const acquisitionCollision: StdioEntry[] = [...BASE_STDIO];
    acquisitionCollision[1] = acquisitionMapped[6] as number;
    await assert.rejects(prepareCampaignWorkerLeases(lease, secondLease, acquisitionCollision), /reuses a source descriptor/);
  } finally {
    let released = true;
    for (const current of [lease, secondLease]) {
      if (!current) continue;
      try { await current.close(); } catch { RETAINED.push(current); released = false; }
    }
    if (released) {
      await rm(root, { recursive: true, force: true });
      await rm(secondRoot, { recursive: true, force: true });
    }
  }
});
