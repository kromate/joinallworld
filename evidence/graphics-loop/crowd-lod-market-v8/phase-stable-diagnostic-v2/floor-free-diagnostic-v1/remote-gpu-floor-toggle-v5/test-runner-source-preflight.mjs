import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(HERE, 'run-bounded-linux.py');
const manifest = await readFile(path.join(HERE, 'source-snapshot.json'));
const expected = createHash('sha256').update(manifest).digest('hex');
const accepted = spawnSync('python3', [runner, '--preflight-source'], {
  cwd: path.resolve(HERE, '../../../../../../'),
  env: { ...process.env, EXPECTED_SOURCE_MANIFEST_SHA256: expected },
  encoding: 'utf8', timeout: 10_000,
});
assert.equal(accepted.error, undefined, `runner preflight launch failed: ${accepted.error?.message}`);
assert.equal(accepted.status, 0, `runner rejected its actual source manifest: ${accepted.stderr}`);
const record = JSON.parse(accepted.stdout);
assert.equal(record.status, 'verified');
assert.equal(record.manifestSha256, expected);
assert.ok(record.pinnedFiles >= 60, `unexpectedly small source closure: ${record.pinnedFiles}`);

const rejected = spawnSync('python3', [runner, '--preflight-source'], {
  cwd: path.resolve(HERE, '../../../../../../'),
  env: { ...process.env, EXPECTED_SOURCE_MANIFEST_SHA256: '0'.repeat(64) },
  encoding: 'utf8', timeout: 10_000,
});
assert.equal(rejected.error, undefined, `runner negative preflight launch failed: ${rejected.error?.message}`);
assert.notEqual(rejected.status, 0, 'runner accepted an incorrect manifest digest');
console.log(JSON.stringify({ status: 'passed', manifestSha256: expected,
  pinnedFiles: record.pinnedFiles, incorrectDigestRejected: true }, null, 2));
