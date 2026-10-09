import assert from 'node:assert/strict';

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
export const MAX_SOURCE_UPGRADE_HISTORY = 16;

function identity(value, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), ['packageDigest', 'sourceSha'], `${label} must contain only source SHA and package digest`);
  assert.ok(SHA.test(value.sourceSha), `${label} source SHA is invalid`);
  assert.ok(DIGEST.test(value.packageDigest), `${label} package digest is invalid`);
  return { sourceSha: value.sourceSha, packageDigest: value.packageDigest };
}

function historyEntry(value, index) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `source upgrade history entry ${index} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), ['from', 'to'], `source upgrade history entry ${index} must contain only from and to`);
  return { from: identity(value.from, `source upgrade history entry ${index} from`), to: identity(value.to, `source upgrade history entry ${index} to`) };
}

export function validateUpgradeArguments(args) {
  if (args.upgradeFrom !== undefined) {
    assert.ok(args.resumeControl, '--upgrade-from requires --resume-control');
    assert.equal(args.recoverInterrupted, false, '--upgrade-from cannot be combined with --recover-interrupted');
    assert.equal(args.retainStore, true, '--upgrade-from requires --retain-store');
    assert.ok(SHA.test(args.upgradeFrom), '--upgrade-from must be exactly 40 lowercase hexadecimal characters');
  }
}

export function assertOwnedGroupGone(isAlive) {
  assert.equal(typeof isAlive, 'function');
  assert.equal(isAlive(), false, 'previous stage process group is still live; refusing source upgrade');
}

/** Pure checkpoint policy. isAncestor(from, to) must establish bounded Git ancestry. */
export function checkpointPolicy({ checkpoint, args, packageDigest, packageManifestSourceSha, isAncestor }) {
  assert.ok(SHA.test(args.sha), 'requested source SHA is invalid');
  assert.ok(DIGEST.test(packageDigest), 'verified package digest is invalid');
  assert.ok(SHA.test(packageManifestSourceSha), 'verified package manifest source SHA is invalid');
  assert.equal(packageManifestSourceSha, args.sha, 'package manifest source SHA differs from requested source');
  const current = identity({ sourceSha: checkpoint.sourceSha, packageDigest: checkpoint.packageDigest }, 'checkpoint current identity');
  assert.equal(checkpoint.packageManifestSourceSha, checkpoint.sourceSha, 'checkpoint manifest SHA is inconsistent');
  const origin = checkpoint.storeOrigin === undefined ? current : identity(checkpoint.storeOrigin, 'checkpoint store origin');
  const rawHistory = checkpoint.sourceUpgradeHistory ?? [];
  assert.ok(Array.isArray(rawHistory), 'source upgrade history must be an array');
  assert.ok(rawHistory.length <= MAX_SOURCE_UPGRADE_HISTORY, 'source upgrade history exceeds 16 entries');
  const history = rawHistory.map(historyEntry);
  if (checkpoint.storeOrigin === undefined) assert.equal(history.length, 0, 'legacy checkpoint cannot contain source upgrade history without a store origin');
  if (history.length) {
    assert.deepEqual(history[0].from, origin, 'source upgrade history must begin at the original store origin');
    for (let index = 1; index < history.length; index += 1) {
      assert.deepEqual(history[index].from, history[index - 1].to, `source upgrade history entry ${index} does not continue its predecessor`);
    }
    assert.deepEqual(history.at(-1).to, current, 'source upgrade history does not end at the checkpoint identity');
  } else {
    assert.deepEqual(current, origin, 'checkpoint identity differs from origin without upgrade history');
  }

  if (args.upgradeFrom === undefined) {
    assert.equal(checkpoint.sourceSha, args.sha, 'resume checkpoint source SHA differs from requested source');
    assert.equal(checkpoint.packageDigest, packageDigest, 'resume checkpoint package digest differs from the verified package');
    return { upgraded: false, storeOrigin: checkpoint.storeOrigin, sourceUpgradeHistory: checkpoint.sourceUpgradeHistory ?? [], marker: { ...origin, storeId: checkpoint.storeId } };
  }

  assert.ok(SHA.test(args.upgradeFrom), '--upgrade-from must be exactly 40 lowercase hexadecimal characters');
  assert.equal(checkpoint.stageStatus, 'stopped', 'source upgrade requires a cleanly stopped checkpoint');
  assert.equal(args.recoverInterrupted, false, 'source upgrade cannot recover an interrupted checkpoint');
  assert.equal(args.upgradeFrom, checkpoint.sourceSha, '--upgrade-from must equal the checkpoint source SHA');
  assert.notEqual(args.sha, checkpoint.sourceSha, 'source upgrade must change the source SHA');
  assert.equal(typeof isAncestor, 'function', 'source upgrade requires a Git ancestry check');
  assert.equal(isAncestor(args.upgradeFrom, args.sha), true, '--upgrade-from must be an ancestor of the requested source SHA');
  assert.ok(history.length < MAX_SOURCE_UPGRADE_HISTORY, 'source upgrade history is full');
  const next = [...history, { from: current, to: { sourceSha: args.sha, packageDigest } }];
  return {
    upgraded: true,
    storeOrigin: origin,
    sourceUpgradeHistory: next,
    marker: { ...origin, storeId: checkpoint.storeId },
  };
}
