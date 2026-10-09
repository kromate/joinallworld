import { readFileSync, readdirSync, readlinkSync } from 'node:fs';

export function parseProcStat(text) {
  const close = text.lastIndexOf(')');
  if (close < 0) throw new Error('malformed /proc stat command field');
  const pid = Number(text.slice(0, text.indexOf(' ')));
  const fields = text.slice(close + 2).trim().split(/\s+/);
  if (!Number.isInteger(pid) || fields.length < 22) throw new Error('malformed /proc stat fields');
  const state = fields[0], ppid = Number(fields[1]), pgrp = Number(fields[2]), rssPages = Number(fields[21]);
  if (!Number.isInteger(ppid) || !Number.isInteger(pgrp) || !Number.isFinite(rssPages) || rssPages < 0) throw new Error('invalid /proc stat numeric fields');
  return { pid, state, ppid, pgrp, rssPages };
}

export function parseVmRssBytes(statusText) {
  const match = statusText.match(/^VmRSS:\s+(\d+)\s+kB\s*$/m);
  return match ? Number(match[1]) * 1024 : 0;
}

export function sampleRowsInProcessGroup(rows, pgid) {
  const live = rows.filter(row => row.pgrp === pgid && row.state !== 'Z');
  return { rows: live, rssBytes: live.reduce((sum, row) => sum + Math.max(0, row.rssBytes), 0) };
}

export function positiveBootstrapWitness(sample, bootstrapPid) {
  return sample.rows.some(row => row.pid === bootstrapPid && row.rssBytes > 0);
}

export function positiveNodeWitness(sample, expectedNodeExe) {
  return sample.rows.some(row => row.exe === expectedNodeExe && row.rssBytes > 0);
}

export function findNodeWitness(sample, expectedNodeExe) {
  return sample.rows.find(row => row.exe === expectedNodeExe && row.rssBytes > 0) ?? null;
}

export function signalProcessGroup(pgid, signal, send = process.kill) {
  try { send(-pgid, signal); return true; }
  catch (error) { if (error?.code === 'ESRCH') return false; throw error; }
}

export function classifyMonitorSample({ sample, phase, bootstrapPid, expectedNodeExe, rssLimitBytes }) {
  if (sample.rssBytes > rssLimitBytes) return 'memory_limit';
  if (phase === 'bootstrap') return positiveBootstrapWitness(sample, bootstrapPid) ? 'release' : 'wait';
  if (phase === 'workload') return positiveNodeWitness(sample, expectedNodeExe) ? 'observed' : 'wait';
  throw new Error(`unknown monitor phase: ${phase}`);
}

export function classifyCompletion({ exitCode, actualNodeSeen }) {
  if (!actualNodeSeen) return 'monitor_error';
  return exitCode === 0 ? 'completed' : 'target_failed';
}

export function workloadResult({ status, peak, peakRows, nodeWitness = null, reason = null }) {
  return { status, reason, peak, peakRows, nodeWitness };
}

export function readLinuxProcessGroup(pgid, procRoot = '/proc') {
  const rows = [];
  for (const name of readdirSync(procRoot)) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name), base = `${procRoot}/${name}`;
    try {
      const stat = parseProcStat(readFileSync(`${base}/stat`, 'utf8'));
      if (stat.pgrp !== pgid || stat.state === 'Z') continue;
      const rssBytes = parseVmRssBytes(readFileSync(`${base}/status`, 'utf8'));
      let exe = '';
      try { exe = readlinkSync(`${base}/exe`); } catch { /* process may exit during sampling */ }
      rows.push({ pid, pgrp: stat.pgrp, state: stat.state, rssBytes, exe });
    } catch { /* process can exit between procfs reads */ }
  }
  return sampleRowsInProcessGroup(rows, pgid);
}
