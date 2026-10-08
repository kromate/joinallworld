import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAdmin1Topology, topologyExitCode } from './admin1-topology.ts';
import type { Admin1TopologyReport } from './admin1-topology-types.ts';
import { createAdmin1TopologyFixture, installFixtureSpatialExtension } from './admin1-topology-fixtures.ts';

const canonical=(value:unknown):string=>value===null||typeof value==='string'||typeof value==='boolean'?JSON.stringify(value):typeof value==='number'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value as object).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;

function report(overrides: Partial<Admin1TopologyReport> = {}): Admin1TopologyReport {
  return {
    schemaVersion: 1, validator: 'natural-earth-admin1-ogc-planar-v1', sourceSha256: 'a'.repeat(64), sourceBytes: 1,
    parentManifestHash: 'b'.repeat(64), publicationManifestHash: 'c'.repeat(64), inspectionSha256: 'd'.repeat(64),
    expectedUnits: 1, checkedUnits: 0, validUnits: 0, invalidUnits: 0, unsupportedUnits: 0, protectedUnits: 1,
    tooling: { duckdbVersion: '1.5.6', spatialVersion: '04270fe', spatialSha256: 'e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9', workerSha256: 'e'.repeat(64), geometryHelperSha256: 'f'.repeat(64) },
    rows: [{ sourceOrdinal: 0, sourceKey: 'NE_ID:1', status: 'protected', valid: null, empty: null, reason: 'protected-nigeria-no-topology', id: 'admin1:natural-earth:NE_ID%3A1', featureSha256: '1'.repeat(64), countryId: null, joinStatus: 'protected' }],
    limitations: ['scope'], ...overrides,
  };
}

test('protected Nigeria alone does not turn topology findings into exit 2', () => {
  assert.equal(topologyExitCode(report()), 0);
});

test('invalid or unsupported nonprotected units produce exit 2', () => {
  assert.equal(topologyExitCode(report({ invalidUnits: 1 })), 2);
  assert.equal(topologyExitCode(report({ unsupportedUnits: 1 })), 2);
});

test('rejects malformed manifest hashes and duration before touching repository state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'admin1-topology-input-'));
  try {
    await assert.rejects(runAdmin1Topology({ repositoryRoot: root, manifestHash: '../bad' }), /publication hash/);
    await assert.rejects(runAdmin1Topology({ repositoryRoot: root, manifestHash: 'a'.repeat(64), durationMs: 120_001 }), /duration/);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('verifies the publication in a child, computes planar evidence once, and reuses its hash-bound pointer', async () => {
  const fixture = await createAdmin1TopologyFixture();
  try {
    await installFixtureSpatialExtension(fixture.root);
    const first = await runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash });
    assert.equal(first.networkBytes, 0);
    assert.equal(first.cacheHit, false);
    assert.equal(first.report.expectedUnits, 2);
    assert.equal(first.report.validUnits, 1);
    assert.equal(first.report.protectedUnits, 1);
    assert.equal(topologyExitCode(first.report), 0);
    const second = await runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash });
    assert.equal(second.cacheHit, true);
    assert.equal(second.reportHash, first.reportHash);
    assert.equal(second.reportPath, first.reportPath);
    const pointerPath = path.join(fixture.root, '.cache/world-build/admin1-topology/requests', `${first.requestHash}.json`);
    const pointer = await readFile(pointerPath);
    await writeFile(pointerPath, Buffer.from('{}\n'));
    await assert.rejects(runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash }), /cache pointer is corrupt/);
    await writeFile(pointerPath, pointer);
    const reportPath = path.join(fixture.root, first.reportPath);
    const reportBytes = await readFile(reportPath);
    await writeFile(reportPath, Buffer.from('{}\n'));
    await assert.rejects(runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash }), /historical topology audit report hash mismatch|cache report hash mismatch/);
    await writeFile(reportPath, reportBytes);
    await unlink(pointerPath);
    const rebuilt = await runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash });
    assert.equal(rebuilt.cacheHit, false);
    assert.equal(rebuilt.reportHash, first.reportHash);
    await unlink(reportPath);
    await assert.rejects(runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash }), /ENOENT|absent/);
    await writeFile(reportPath, reportBytes);
    const auditRoot = path.join(fixture.root, '.cache/world-build/admin1-topology/attempts');
    const auditFile = path.join(auditRoot, `${first.requestHash}.jsonl`);
    const lines = (await readFile(auditFile, 'utf8')).trimEnd().split('\n');
    const originalStart = JSON.parse(lines[0]!) as Record<string, unknown>;
    const request = originalStart.request;
    const added: string[] = [];
    for (let index = 0; index < 6; index++) {
      const attemptId = randomUUID(), startedAt = new Date(Date.now() + index * 3).toISOString();
      added.push(canonical({ schemaVersion: 1, requestHash: first.requestHash, attemptId, event: 'started', status: 'pending', request, startedAt }));
      added.push(canonical({ schemaVersion: 1, requestHash: first.requestHash, attemptId, event: 'finished', status: 'aborted', endedAt: new Date(Date.parse(startedAt) + 1).toISOString(), error: 'synthetic prior process interruption' }));
    }
    await writeFile(auditFile, `${lines.join('\n')}\n${added.join('\n')}\n`);
    assert.equal((await runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash })).cacheHit, true, 'verified cache remains readable after lifetime attempt cap');
    await unlink(pointerPath);
    let pythonStarted = false;
    await assert.rejects(runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash, onPythonSpawn: () => { pythonStarted = true; } }), /lifetime attempt cap/);
    assert.equal(pythonStarted, false);
  } finally { await fixture.cleanup(); }
});

test('an admitted Python worker is terminated, its attempt remains charged, and a later run resumes', async () => {
  const fixture = await createAdmin1TopologyFixture();
  const abort = new AbortController();
  try {
    await installFixtureSpatialExtension(fixture.root);
    let observedPid = 0;
    await assert.rejects(runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash, signal: abort.signal,
      onPythonSpawn: pid => { observedPid = pid; abort.abort(new Error('test interruption')); } }), /test interruption|aborted/);
    assert.ok(observedPid > 0);
    const attemptsRoot = path.join(fixture.root, '.cache/world-build/admin1-topology/attempts');
    const [auditName] = await readdir(attemptsRoot);
    assert.ok(auditName);
    const auditText = await readFile(path.join(attemptsRoot, auditName!), 'utf8');
    assert.match(auditText, /"event":"finished"/);
    assert.match(auditText, /"status":"aborted"/);
    const pendingStart = auditText.split('\n')[0]!;
    await writeFile(path.join(attemptsRoot, auditName!), `${pendingStart}\n`);
    const resumed = await runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash });
    assert.equal(resumed.cacheHit, false);
    assert.equal(resumed.report.protectedUnits, 1);
    const completed = await runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash });
    assert.equal(completed.cacheHit, true);
  } finally { await fixture.cleanup(); }
});

test('publishes invalid planar findings with exit code 2 and does not call protected rows failures', async () => {
  const fixture = await createAdmin1TopologyFixture(true);
  try {
    await installFixtureSpatialExtension(fixture.root);
    const result = await runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash });
    assert.ok(result.report.invalidUnits > 0);
    assert.equal(result.report.protectedUnits, 1);
    assert.equal(topologyExitCode(result.report), 2);
  } finally { await fixture.cleanup(); }
});

test('rejects symlinked topology state before creating topology assets', async () => {
  const fixture = await createAdmin1TopologyFixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'admin1-topology-outside-'));
  try {
    await installFixtureSpatialExtension(fixture.root);
    const topologyRoot = path.join(fixture.root, '.cache/world-build/admin1-topology');
    await rm(topologyRoot, { recursive: true, force: true });
    await (await import('node:fs/promises')).symlink(outside, topologyRoot);
    await assert.rejects(runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash }), /symlink|unsafe/);
    assert.deepEqual(await readdir(outside), []);
  } finally { await fixture.cleanup(); await rm(outside, { recursive: true, force: true }); }
});

test('deadline expiring during monitored verification does not launch Python or publish topology state', async () => {
  const fixture = await createAdmin1TopologyFixture();
  try {
    let pythonStarted = false;
    await assert.rejects(runAdmin1Topology({ repositoryRoot: fixture.root, manifestHash: fixture.manifestHash, durationMs: 1, onPythonSpawn: () => { pythonStarted = true; } }), /deadline|exceeded|aborted/);
    assert.equal(pythonStarted, false);
    await assert.rejects(readdir(path.join(fixture.root, '.cache/world-build/admin1-topology/attempts')), { code: 'ENOENT' });
  } finally { await fixture.cleanup(); }
});
