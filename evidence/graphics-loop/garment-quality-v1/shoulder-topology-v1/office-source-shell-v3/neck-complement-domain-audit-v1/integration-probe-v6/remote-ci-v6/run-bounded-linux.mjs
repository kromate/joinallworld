import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCompletion, classifyMonitorSample, findNodeWitness, readLinuxProcessGroup, signalProcessGroup, workloadResult } from './proc-monitor.mjs';
import { verifySnapshot } from './verify-snapshot.mjs';
import { gatedEnvironment } from './browser-result-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../../../..');
const BASE = path.resolve(HERE, 'remote-results');
const BOOTSTRAP = path.join(HERE, 'exec-gated.py');
const BUNDLE = path.join(HERE, 'bundle.mjs');
const BROWSER = path.join(HERE, 'review-cdp.mjs');
const TESTS = [
  path.resolve(HERE, '../coverage.test.ts'),
  path.resolve(HERE, '../domain-audit.test.ts'),
  path.resolve(HERE, '../skin-weight-encoding.test.ts'),
  path.join(HERE, 'proc-monitor.test.mjs'),
  path.join(HERE, 'browser-result-contract.test.mjs'),
  path.join(HERE, 'cdp-exception.test.mjs'),
  path.join(HERE, 'domain-witness-contract.test.mjs'),
];
const LIMITS = {
  build: { rss: 220 * 1024 * 1024, seconds: 25 },
  synthetic: { rss: 220 * 1024 * 1024, seconds: 25 },
  browser: { rss: 2 * 1024 * 1024 * 1024, seconds: 60 },
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const childFinished = child => child.exitCode !== null || child.signalCode !== null;
function commandFor(mode, expected) {
  if (mode === 'build') return ['node', '--max-old-space-size=96', BUNDLE, expected];
  if (mode === 'synthetic') return ['node', '--max-old-space-size=96', '--experimental-strip-types', '--test', '--test-concurrency=1', ...TESTS];
  return ['node', '--max-old-space-size=96', BROWSER, expected];
}

function readyByte(stream, child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true; clearTimeout(timer);
      stream.off('data', onData); stream.off('end', onEnd); child.off('error', onError);
      error ? reject(error) : resolve(value);
    };
    const onData = chunk => finish(null, chunk[0]);
    const onEnd = () => finish(new Error('bootstrap ready pipe closed before readiness'));
    const onError = error => finish(error);
    const timer = setTimeout(() => finish(new Error('bootstrap readiness timed out')), timeoutMs);
    stream.once('data', onData); stream.once('end', onEnd); child.once('error', onError);
  });
}

async function waitForPositiveBootstrap(child, limitBytes, deadline) {
  while (Date.now() < deadline && !childFinished(child)) {
    const sample = readLinuxProcessGroup(child.pid);
    const result = classifyMonitorSample({ sample, phase: 'bootstrap', bootstrapPid: child.pid, rssLimitBytes: limitBytes });
    if (result === 'release') return sample;
    if (result === 'memory_limit') throw Object.assign(new Error('bootstrap process group exceeds RSS limit before workload release'), { status: 'memory_limit', sample });
    await sleep(5);
  }
  throw Object.assign(new Error(child.exitCode === null ? 'no positive bootstrap RSS sample before deadline' : 'bootstrap exited before a positive RSS sample'), { status: 'monitor_error' });
}

async function waitForActualNode(child, expectedNodeExe, limitBytes, deadline, initialPeak) {
  let peak = initialPeak.rssBytes, peakRows = initialPeak.rows, nodeWitness = null;
  while (Date.now() < deadline) {
    const sample = readLinuxProcessGroup(child.pid);
    if (sample.rssBytes > peak) { peak = sample.rssBytes; peakRows = sample.rows; }
    const result = classifyMonitorSample({ sample, phase: 'workload', expectedNodeExe, rssLimitBytes: limitBytes });
    if (result === 'memory_limit') return workloadResult({ status: 'memory_limit', reason: 'process group exceeded RSS limit before the first positive Node witness', peak, peakRows, nodeWitness });
    if (result === 'observed') { nodeWitness = findNodeWitness(sample, expectedNodeExe); break; }
    if (childFinished(child)) return workloadResult({ status: 'monitor_error', reason: 'target exited before a positive Node RSS witness', peak, peakRows, nodeWitness });
    await sleep(2);
  }
  if (!nodeWitness) return workloadResult({ status: 'monitor_error', reason: 'no positive actual-Node RSS witness before deadline', peak, peakRows, nodeWitness });
  while (!childFinished(child) && Date.now() < deadline) {
    const sample = readLinuxProcessGroup(child.pid);
    if (sample.rssBytes > peak) { peak = sample.rssBytes; peakRows = sample.rows; }
    if (sample.rssBytes > limitBytes) return workloadResult({ status: 'memory_limit', reason: 'process group exceeded RSS limit after the positive Node witness', peak, peakRows, nodeWitness });
    await sleep(20);
  }
  if (!childFinished(child)) return workloadResult({ status: 'timeout', reason: 'process group exceeded wall limit', peak, peakRows, nodeWitness });
  const status = classifyCompletion({ exitCode: child.exitCode ?? 128, actualNodeSeen: Boolean(nodeWitness) });
  return workloadResult({ status, reason: status === 'monitor_error' ? 'target exited before a positive Node RSS witness' : null, peak, peakRows, nodeWitness });
}

async function terminateGroup(child) {
  if (!Number.isInteger(child.pid)) return true;
  const waitForGone = async timeoutMs => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const sample = readLinuxProcessGroup(child.pid);
      if (sample.rows.length === 0) return true;
      await sleep(20);
    }
    return readLinuxProcessGroup(child.pid).rows.length === 0;
  };
  for (const [signal, timeout] of [['SIGTERM', 1200], ['SIGKILL', 1800]]) {
    try { signalProcessGroup(child.pid, signal); } catch { return false; }
    if (await waitForGone(timeout)) return true;
  }
  return false;
}

async function run(mode, expected) {
  if (process.platform !== 'linux') throw new Error('Remote Linux only; do not run on workstation');
  const limits = LIMITS[mode];
  if (!limits) throw new Error('usage: run-bounded-linux.mjs build|synthetic|browser expected-manifest-sha256');
  const snapshotBefore = await verifySnapshot(expected);
  const runId = process.env.GITHUB_RUN_ID;
  if (!/^\d+$/.test(runId ?? '')) throw new Error('GITHUB_RUN_ID required for unique result directory');
  const resultDir = path.join(BASE, runId);
  mkdirSync(resultDir, { recursive: true });
  const logPath = path.join(resultDir, `${mode}.log`), receiptPath = path.join(resultDir, `${mode}.receipt.json`);
  if (existsSync(logPath) || existsSync(receiptPath)) throw new Error('Refusing to overwrite run artifacts');
  const logFd = openSync(logPath, 'wx');
  const argv = commandFor(mode, expected), started = Date.now(), deadline = started + limits.seconds * 1000;
  const gateEnv = { ...gatedEnvironment(mode, resultDir, process.env), MONITOR_READY_FD: '3', MONITOR_GATE_FD: '4' };
  const child = spawn('python3', [BOOTSTRAP, JSON.stringify(argv)], {
    cwd: ROOT, env: gateEnv, detached: true,
    stdio: ['ignore', logFd, logFd, 'pipe', 'pipe'],
  });
  let status = 'running', reason = null, childExitCode = null, peak = 0, peakRows = [], initialSample = null, actualNodeWitness = null, cleanupVerified = false;
  try {
    const ready = await readyByte(child.stdio[3], child, Math.min(2000, limits.seconds * 1000));
    if (ready !== 0x52) throw Object.assign(new Error(`unexpected bootstrap readiness byte ${ready}`), { status: 'monitor_error' });
    initialSample = await waitForPositiveBootstrap(child, limits.rss, Math.min(deadline, Date.now() + 1500));
    peak = initialSample.rssBytes; peakRows = initialSample.rows;
    child.stdio[4].end(Buffer.from('G'));
    const nodeExe = realpathSync(process.execPath);
    const measured = await waitForActualNode(child, nodeExe, limits.rss, deadline, initialSample);
    status = measured.status; reason = measured.reason ?? null; peak = measured.peak; peakRows = measured.peakRows; actualNodeWitness = measured.nodeWitness;
    if (status === 'completed') childExitCode = child.exitCode;
    else if (status === 'memory_limit' || status === 'timeout' || status === 'target_failed') childExitCode = child.exitCode;
  } catch (error) {
    status = error.status ?? 'monitor_error'; reason = error.message; childExitCode = child.exitCode;
  } finally {
    await terminateGroup(child);
    cleanupVerified = readLinuxProcessGroup(child.pid).rows.length === 0;
    childExitCode = child.exitCode;
    closeSync(logFd);
  }
  const snapshotAfter = await verifySnapshot(expected).catch(error => ({ error: String(error) }));
  const sourceUnchanged = !snapshotAfter.error && JSON.stringify(snapshotBefore.sourceHashes) === JSON.stringify(snapshotAfter.sourceHashes);
  if (!sourceUnchanged) status = 'source_changed';
  if (!cleanupVerified) status = 'cleanup_error';
  const receipt = {
    schema: 'allworld-neck-domain-audit-process-gate-v2', mode, status, reason,
    command: argv, bootstrap: 'same process group; waits for monitor gate then spawns exact argv; target is separately identified by /proc/<pid>/exe',
    childExitCode, elapsedSeconds: Number(((Date.now() - started) / 1000).toFixed(3)),
    childSignalCode: child.signalCode,
    rssLimitBytes: limits.rss, wallLimitSeconds: limits.seconds,
    bootstrapWitness: initialSample ? { positive: true, rssBytes: initialSample.rssBytes, processes: initialSample.rows } : null,
    actualNodeWitness: { positive: Boolean(actualNodeWitness), expectedExe: realpathSync(process.execPath), process: actualNodeWitness },
    peakProcessGroupRssBytes: peak, peakProcessWitness: peakRows,
    cleanupVerified, sourceHashesBefore: snapshotBefore.sourceHashes,
    sourceHashesAfter: snapshotAfter.sourceHashes ?? null, sourceUnchanged,
    expectedSnapshotSha256: expected, artifactDir: resultDir, log: logPath,
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(receipt, null, 2));
  if (status === 'completed' && childExitCode === 0 && actualNodeWitness && peak <= limits.rss && sourceUnchanged && cleanupVerified) return 0;
  if (status === 'timeout') return 124;
  return status === 'memory_limit' || status === 'monitor_error' || status === 'source_changed' || status === 'cleanup_error' ? 125 : (childExitCode || 1);
}

run(process.argv[2], process.argv[3]).then(code => { process.exitCode = code; }).catch(error => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
