import test from 'node:test';
import assert from 'node:assert/strict';
import { assertOwnedGroupGone, checkpointPolicy, validateUpgradeArguments } from './stage-checkpoint-policy.mjs';

const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40), d = 'd'.repeat(40);
const da = '1'.repeat(64), db = '2'.repeat(64), dc = '3'.repeat(64), dd = '4'.repeat(64);
const base = (sourceSha = a, packageDigest = da, extras = {}) => ({
  schemaVersion: 1, stageStatus: 'stopped', sourceSha, packageDigest,
  packageManifestSourceSha: sourceSha, storeId: '12345678-1234-1234-1234-123456789abc', ...extras,
});
const args = (sha = a, extras = {}) => ({ sha, resumeControl: '/private/checkpoint', recoverInterrupted: false, retainStore: true, ...extras });
const policy = (checkpoint, requested, digest, ancestry = () => true) => checkpointPolicy({
  checkpoint, args: requested, packageDigest: digest, packageManifestSourceSha: requested.sha, isAncestor: ancestry,
});

test('legacy checkpoint can resume same source and expects its original marker', () => {
  const result = policy(base(), args(), da);
  assert.equal(result.upgraded, false);
  assert.equal(result.storeOrigin, undefined);
  assert.deepEqual(result.marker, { sourceSha: a, packageDigest: da, storeId: base().storeId });
  assert.deepEqual(result.sourceUpgradeHistory, []);
});

test('legacy checkpoint upgrades and records origin without rewriting expected marker', () => {
  const checkpoint = base();
  const result = policy(checkpoint, args(b, { upgradeFrom: a }), db);
  assert.equal(result.upgraded, true);
  assert.deepEqual(result.storeOrigin, { sourceSha: a, packageDigest: da });
  assert.deepEqual(result.marker, { sourceSha: a, packageDigest: da, storeId: checkpoint.storeId });
  assert.deepEqual(result.sourceUpgradeHistory, [{ from: { sourceSha: a, packageDigest: da }, to: { sourceSha: b, packageDigest: db } }]);
  assert.deepEqual(checkpoint, base(), 'policy leaves the checkpoint and persisted marker data untouched');
});

test('upgraded checkpoint validates and extends a linked provenance chain', () => {
  const checkpoint = base(b, db, { storeOrigin: { sourceSha: a, packageDigest: da }, sourceUpgradeHistory: [{ from: { sourceSha: a, packageDigest: da }, to: { sourceSha: b, packageDigest: db } }] });
  const result = policy(checkpoint, args(c, { upgradeFrom: b }), dc);
  assert.deepEqual(result.storeOrigin, { sourceSha: a, packageDigest: da });
  assert.deepEqual(result.marker, { sourceSha: a, packageDigest: da, storeId: checkpoint.storeId });
  assert.deepEqual(result.sourceUpgradeHistory.at(-1), { from: { sourceSha: b, packageDigest: db }, to: { sourceSha: c, packageDigest: dc } });
});

test('same-source resume remains exact and rejects a different package digest', () => {
  assert.equal(policy(base(), args(), da).upgraded, false);
  assert.throws(() => policy(base(), args(), db), /package digest differs/);
});

test('upgrade requires exact prior source, a different digest-consistent target, and ancestor relation', () => {
  assert.throws(() => policy(base(), args(b, { upgradeFrom: c }), db), /must equal the checkpoint source SHA/);
  assert.throws(() => policy(base(), args(b, { upgradeFrom: a }), db, () => false), /must be an ancestor/);
  assert.throws(() => policy(base(b, da, { packageManifestSourceSha: a }), args(c, { upgradeFrom: b }), db), /checkpoint manifest SHA is inconsistent/);
  assert.throws(() => policy(base(), args('bad'), da), /requested source SHA is invalid/);
  assert.throws(() => policy(base(), args(), 'bad'), /verified package digest is invalid/);
});

test('upgrade flags reject missing resume and interrupted recovery', () => {
  assert.throws(() => validateUpgradeArguments({ upgradeFrom: a, recoverInterrupted: false }), /requires --resume-control/);
  assert.throws(() => validateUpgradeArguments({ upgradeFrom: a, resumeControl: 'x', recoverInterrupted: true }), /cannot be combined/);
  assert.throws(() => validateUpgradeArguments({ upgradeFrom: a, resumeControl: 'x', recoverInterrupted: false, retainStore: false }), /requires --retain-store/);
  assert.throws(() => validateUpgradeArguments({ upgradeFrom: 'bad', resumeControl: 'x', recoverInterrupted: false, retainStore: true }), /exactly 40/);
});

test('source upgrade requires an absent prior process group', () => {
  assertOwnedGroupGone(() => false);
  assert.throws(() => assertOwnedGroupGone(() => true), /process group is still live/);
});

test('rejects malformed origins, broken chains, and provenance over 16 entries', () => {
  assert.throws(() => policy(base(b, db, { storeOrigin: { sourceSha: a, packageDigest: 'bad' }, sourceUpgradeHistory: [] }), args(b), db), /package digest is invalid/);
  assert.throws(() => policy(base(b, db, { storeOrigin: { sourceSha: a, packageDigest: da, extra: true }, sourceUpgradeHistory: [] }), args(b), db), /only source SHA and package digest/);
  assert.throws(() => policy(base(b, db, { storeOrigin: { sourceSha: a, packageDigest: da }, sourceUpgradeHistory: [{ from: { sourceSha: a, packageDigest: da, extra: true }, to: { sourceSha: b, packageDigest: db } }] }), args(b), db), /only source SHA and package digest/);
  assert.throws(() => policy(base(b, db, { storeOrigin: { sourceSha: a, packageDigest: da }, sourceUpgradeHistory: [{ from: { sourceSha: a, packageDigest: da }, to: { sourceSha: b, packageDigest: db, extra: true } }] }), args(b), db), /only source SHA and package digest/);
  assert.throws(() => policy(base(b, db, { storeOrigin: { sourceSha: a, packageDigest: da }, sourceUpgradeHistory: [{ from: { sourceSha: a, packageDigest: da }, to: { sourceSha: b, packageDigest: db }, extra: true }] }), args(b), db), /only from and to/);
  const broken = base(b, db, { storeOrigin: { sourceSha: a, packageDigest: da }, sourceUpgradeHistory: [{ from: { sourceSha: d, packageDigest: dd }, to: { sourceSha: b, packageDigest: db } }] });
  assert.throws(() => policy(broken, args(b), db), /begin at the original store origin/);
  const middle = base(c, dc, { storeOrigin: { sourceSha: a, packageDigest: da }, sourceUpgradeHistory: [
    { from: { sourceSha: a, packageDigest: da }, to: { sourceSha: b, packageDigest: db } },
    { from: { sourceSha: d, packageDigest: dd }, to: { sourceSha: c, packageDigest: dc } },
  ] });
  assert.throws(() => policy(middle, args(c), dc), /does not continue its predecessor/);
  const end = base(c, dc, { storeOrigin: { sourceSha: a, packageDigest: da }, sourceUpgradeHistory: [{ from: { sourceSha: a, packageDigest: da }, to: { sourceSha: b, packageDigest: db } }] });
  assert.throws(() => policy(end, args(c), dc), /does not end at the checkpoint identity/);
  const noHistoryOrigin = base(b, db, { storeOrigin: { sourceSha: a, packageDigest: da } });
  assert.throws(() => policy(noHistoryOrigin, args(b), db), /differs from origin without upgrade history/);
  const longHistory = Array.from({ length: 17 }, (_, index) => ({ from: { sourceSha: a, packageDigest: da }, to: { sourceSha: b, packageDigest: db } }));
  assert.throws(() => policy(base(b, db, { storeOrigin: { sourceSha: a, packageDigest: da }, sourceUpgradeHistory: longHistory }), args(b), db), /exceeds 16 entries/);
});
