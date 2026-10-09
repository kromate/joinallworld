import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { browserResultPaths, gatedEnvironment } from './browser-result-contract.mjs';

test('browser workload passes its absolute per-run result root to the controller', () => {
  const runRoot = path.join(os.tmpdir(), 'remote-results', '37905711660');
  const env = gatedEnvironment('browser', runRoot, { RESULT_DIR: '/stale-parent-path', CI: 'true' });
  const paths = browserResultPaths(env.RESULT_DIR);
  assert.equal(env.RESULT_DIR, runRoot);
  assert.equal(paths.output, path.join(runRoot, 'browser-artifacts'));
  assert.equal(paths.stages, path.join(runRoot, 'browser-stages.jsonl'));
  assert.notEqual(paths.output, runRoot, 'browser artifacts must not collide with build/browser receipts and logs');
  assert.equal(env.CI, 'true');
});

test('the browser contract rejects missing or relative output roots before launching Chrome', () => {
  assert.throws(() => gatedEnvironment('browser', '', {}), /absolute per-run directory/);
  assert.throws(() => browserResultPaths('remote-results/123'), /absolute per-run directory/);
});

test('non-browser workloads cannot inherit a stale RESULT_DIR', () => {
  assert.equal('RESULT_DIR' in gatedEnvironment('build', '/unused', { RESULT_DIR: '/stale' }), false);
  assert.equal('RESULT_DIR' in gatedEnvironment('synthetic', '/unused', { RESULT_DIR: '/stale' }), false);
});
