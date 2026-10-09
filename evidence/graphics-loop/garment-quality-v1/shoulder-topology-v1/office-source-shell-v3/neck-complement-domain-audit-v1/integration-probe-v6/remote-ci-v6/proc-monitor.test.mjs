import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  classifyCompletion,
  classifyMonitorSample,
  findNodeWitness,
  parseProcStat,
  parseVmRssBytes,
  positiveBootstrapWitness,
  positiveNodeWitness,
  sampleRowsInProcessGroup,
  signalProcessGroup,
  workloadResult,
} from './proc-monitor.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, 'exec-gated.py');

const stat = (pid, comm, state, ppid, pgrp, rssPages) => {
  const tail = [state, ppid, pgrp, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, rssPages];
  return `${pid} (${comm}) ${tail.join(' ')}`;
};
test('proc stat parser handles spaces and closing parentheses in comm', () => {
  assert.deepEqual(parseProcStat(stat(17, 'python bootstrap) worker', 'S', 1, 17, 19)), {
    pid: 17, state: 'S', ppid: 1, pgrp: 17, rssPages: 19,
  });
});

test('VmRSS parser returns bytes and treats a missing/zero row as no witness', () => {
  assert.equal(parseVmRssBytes('Name:\tnode\nVmRSS:\t42 kB\n'), 42 * 1024);
  assert.equal(parseVmRssBytes('Name:\tnode\nVmSize:\t42 kB\n'), 0);
  assert.equal(parseVmRssBytes('VmRSS:\t0 kB\n'), 0);
});

test('group RSS excludes unrelated groups, zero rows, and zombies', () => {
  const sample = sampleRowsInProcessGroup([
    { pid: 10, pgrp: 10, state: 'S', rssBytes: 100, exe: '/usr/bin/python3' },
    { pid: 11, pgrp: 10, state: 'S', rssBytes: 200, exe: '/usr/bin/node' },
    { pid: 12, pgrp: 99, state: 'S', rssBytes: 900, exe: '/usr/bin/node' },
    { pid: 13, pgrp: 10, state: 'Z', rssBytes: 300, exe: '/usr/bin/node' },
    { pid: 14, pgrp: 10, state: 'S', rssBytes: 0, exe: '/usr/bin/node' },
  ], 10);
  assert.equal(sample.rssBytes, 300);
  assert.deepEqual(sample.rows.map(row => row.pid), [10, 11, 14]);
});

test('gate release requires positive RSS from the owned bootstrap itself', () => {
  const good = { rows: [{ pid: 20, rssBytes: 30 }], rssBytes: 30 };
  const unrelated = { rows: [{ pid: 21, rssBytes: 30 }], rssBytes: 30 };
  const zero = { rows: [{ pid: 20, rssBytes: 0 }], rssBytes: 0 };
  assert.equal(positiveBootstrapWitness(good, 20), true);
  assert.equal(positiveBootstrapWitness(unrelated, 20), false);
  assert.equal(positiveBootstrapWitness(zero, 20), false);
  assert.equal(classifyMonitorSample({ sample: good, phase: 'bootstrap', bootstrapPid: 20, rssLimitBytes: 100 }), 'release');
  assert.equal(classifyMonitorSample({ sample: zero, phase: 'bootstrap', bootstrapPid: 20, rssLimitBytes: 100 }), 'wait');
  assert.equal(classifyMonitorSample({ sample: good, phase: 'bootstrap', bootstrapPid: 20, rssLimitBytes: 20 }), 'memory_limit');
});

test('completion requires a positive actual Node executable sample, not bootstrap-only RSS', () => {
  const bootstrapOnly = { rows: [{ pid: 30, exe: '/usr/bin/python3', rssBytes: 40 }], rssBytes: 40 };
  const actualNode = { rows: [{ pid: 31, exe: '/opt/node/bin/node', rssBytes: 60 }], rssBytes: 60 };
  assert.equal(positiveNodeWitness(bootstrapOnly, '/opt/node/bin/node'), false);
  assert.equal(positiveNodeWitness(actualNode, '/opt/node/bin/node'), true);
  assert.deepEqual(findNodeWitness(actualNode, '/opt/node/bin/node'), actualNode.rows[0]);
  assert.equal(classifyCompletion({ exitCode: 0, actualNodeSeen: false }), 'monitor_error');
  assert.equal(classifyCompletion({ exitCode: 0, actualNodeSeen: true }), 'completed');
  assert.equal(classifyCompletion({ exitCode: 7, actualNodeSeen: true }), 'target_failed');
  assert.equal(classifyMonitorSample({ sample: actualNode, phase: 'workload', expectedNodeExe: '/opt/node/bin/node', rssLimitBytes: 50 }), 'memory_limit');
});

test('termination targets the whole negative-PGID and tolerates ESRCH only', () => {
  const sent = [];
  assert.equal(signalProcessGroup(41, 'SIGTERM', (pid, signal) => sent.push({ pid, signal })), true);
  assert.deepEqual(sent, [{ pid: -41, signal: 'SIGTERM' }]);
  const missing = Object.assign(new Error('gone'), { code: 'ESRCH' });
  assert.equal(signalProcessGroup(41, 'SIGKILL', () => { throw missing; }), false);
  assert.throws(() => signalProcessGroup(41, 'SIGTERM', () => { throw new Error('denied'); }), /denied/);
});

test('both pre-witness and post-witness cap outcomes preserve defined evidence fields', () => {
  const peaks = [{ pid: 5, rssBytes: 500 }];
  const beforeNode = workloadResult({
    status: 'memory_limit', reason: 'pre-witness cap', peak: 500, peakRows: peaks,
  });
  const node = { pid: 6, exe: '/opt/node/bin/node', rssBytes: 400 };
  const afterNode = workloadResult({
    status: 'memory_limit', reason: 'post-witness cap', peak: 900, peakRows: [...peaks, node], nodeWitness: node,
  });
  assert.deepEqual(beforeNode, { status: 'memory_limit', reason: 'pre-witness cap', peak: 500, peakRows: peaks, nodeWitness: null });
  assert.deepEqual(afterNode, { status: 'memory_limit', reason: 'post-witness cap', peak: 900, peakRows: [...peaks, node], nodeWitness: node });
});

test('bootstrap does not launch the target until the monitor releases its gate', async () => {
  const target = ['/bin/sh', '-c', 'printf gated-target-ran'];
  const child = spawn('python3', [GATE, JSON.stringify(target)], {
    env: { ...process.env, MONITOR_READY_FD: '3', MONITOR_GATE_FD: '4' },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(chunk));
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bootstrap did not signal readiness')), 2000);
    child.stdio[3].once('data', bytes => { clearTimeout(timer); resolve(bytes[0]); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  assert.equal(ready, 0x52);
  assert.equal(child.stdout.readableLength, 0);
  child.stdio[4].end(Buffer.from('G'));
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code));
  });
  assert.equal(exitCode, 0);
  assert.equal(Buffer.concat(output).toString(), 'gated-target-ran');
});

test('closing the gate fails closed without launching the target', async () => {
  const target = ['/bin/sh', '-c', 'printf must-not-run'];
  const child = spawn('python3', [GATE, JSON.stringify(target)], {
    env: { ...process.env, MONITOR_READY_FD: '3', MONITOR_GATE_FD: '4' },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(chunk));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bootstrap did not signal readiness')), 2000);
    child.stdio[3].once('data', bytes => { clearTimeout(timer); resolve(bytes[0]); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
  child.stdio[4].end();
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code));
  });
  assert.equal(exitCode, 125);
  assert.equal(Buffer.concat(output).length, 0);
});
