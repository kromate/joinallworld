import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const MAX_CONTROL_BYTES = 16 * 1024;

export class ControlPublicationError extends Error {
  constructor(committedIdentity, cause) {
    super('checkpoint was published but post-rename durability or verification failed');
    this.name = 'ControlPublicationError';
    this.committedIdentity = committedIdentity;
    this.cause = cause;
  }
}

export async function publishControlState(state, value, write) {
  try {
    state.controlIdentity = await write(state.controlIdentity, value);
    state.controlState = value;
    state.stageStarted = true;
    return state.controlIdentity;
  } catch (error) {
    if (error instanceof ControlPublicationError) {
      state.controlIdentity = error.committedIdentity;
      state.controlState = value;
      state.stageStarted = true;
      state.forceRetainCheckpoint = true;
    }
    throw error;
  }
}

async function privateParent(path, uid) {
  const parent = dirname(path);
  const stat = await lstat(parent);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'checkpoint parent must be a real directory');
  assert.equal(stat.uid, uid, 'checkpoint parent must be owned by the current user');
  assert.equal(stat.mode & 0o777, 0o700, 'checkpoint parent permissions must be 0700');
  assert.equal(await realpath(parent), parent, 'checkpoint parent must be canonical');
  return parent;
}

async function checkedFile(path, identity, uid) {
  const stat = await lstat(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'private control file must be a regular file');
  assert.equal(stat.dev, identity.dev, 'private control file identity changed; refusing checkpoint update');
  assert.equal(stat.ino, identity.ino, 'private control file identity changed; refusing checkpoint update');
  assert.equal(stat.uid, uid, 'private control file must be owned by the current user');
  assert.equal(stat.mode & 0o777, 0o600, 'private control file permissions must be 0600');
  return stat;
}

async function removeOwned(path, identity) {
  if (!identity) return;
  try {
    const stat = await lstat(path);
    if (stat.isFile() && stat.dev === identity.dev && stat.ino === identity.ino) await unlink(path);
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
}

export async function replacePrivateControl(path, identity, contents, { beforeRename, afterRename } = {}) {
  assert.equal(typeof constants.O_NOFOLLOW, 'number', 'this platform must support O_NOFOLLOW for checkpoint safety');
  assert.equal(typeof contents, 'string');
  assert.ok(Buffer.byteLength(contents, 'utf8') <= MAX_CONTROL_BYTES, 'resume checkpoint exceeds the 16384-byte limit');
  const uid = process.getuid();
  const parent = await privateParent(path, uid);
  await checkedFile(path, identity, uid);
  const temporary = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let temporaryIdentity;
  let renamed = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      const stat = await handle.stat();
      temporaryIdentity = { dev: stat.dev, ino: stat.ino };
      assert.ok(Number.isSafeInteger(temporaryIdentity.dev) && Number.isSafeInteger(temporaryIdentity.ino), 'temporary control identity must use safe integers');
      await handle.chmod(0o600);
      await handle.writeFile(contents, { encoding: 'utf8' });
      await handle.sync();
    } finally { await handle.close(); }

    assert.equal(await privateParent(path, uid), parent, 'checkpoint parent changed during update');
    await checkedFile(path, identity, uid);
    if (beforeRename) await beforeRename();
    await checkedFile(path, identity, uid);
    const temporaryStat = await lstat(temporary);
    assert.ok(temporaryStat.isFile() && temporaryStat.dev === temporaryIdentity.dev && temporaryStat.ino === temporaryIdentity.ino, 'owned control temporary identity changed');
    await rename(temporary, path);
    renamed = true;
    const committedIdentity = { ...temporaryIdentity };
    try {
      if (afterRename) await afterRename(committedIdentity);
      const directory = await open(parent, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_DIRECTORY ?? 0));
      try { await directory.sync(); } finally { await directory.close(); }
      const replacement = await lstat(path);
      assert.ok(replacement.isFile() && !replacement.isSymbolicLink(), 'replacement control file must be regular');
      assert.equal(replacement.dev, committedIdentity.dev);
      assert.equal(replacement.ino, committedIdentity.ino);
      assert.equal(replacement.uid, uid);
      assert.equal(replacement.mode & 0o777, 0o600);
      return committedIdentity;
    } catch (error) {
      throw new ControlPublicationError(committedIdentity, error);
    }
  } catch (error) {
    if (!renamed) await removeOwned(temporary, temporaryIdentity).catch(() => {});
    throw error;
  }
}
