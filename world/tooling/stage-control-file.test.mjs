import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replacePrivateControl } from './stage-control-file.mjs';

async function fixture(t) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'sealed-control-policy-')));
  await chmod(parent, 0o700);
  const path = join(parent, 'control.json');
  const original = Buffer.from('{"stageStatus":"stopped"}\n');
  await writeFile(path, original, { flag: 'wx', mode: 0o600 });
  await chmod(path, 0o600);
  const stat = await lstat(path);
  t.after(() => rm(parent, { recursive: true, force: true }));
  return { parent, path, original, identity: { dev: stat.dev, ino: stat.ino } };
}

test('a failure before rename preserves old checkpoint bytes and removes only the owned temp file', async t => {
  const state = await fixture(t);
  await assert.rejects(replacePrivateControl(state.path, state.identity, '{"stageStatus":"running"}\n', {
    beforeRename: async () => { throw new Error('injected before rename'); },
  }), /injected before rename/);
  assert.deepEqual(await readFile(state.path), state.original);
  assert.deepEqual(await readdir(state.parent), ['control.json']);
});

test('successful atomic replacement returns the new identity and refuses the old one', async t => {
  const state = await fixture(t);
  const replacement = '{"stageStatus":"running"}\n';
  const nextIdentity = await replacePrivateControl(state.path, state.identity, replacement);
  assert.notDeepEqual(nextIdentity, state.identity);
  assert.equal(await readFile(state.path, 'utf8'), replacement);
  await assert.rejects(replacePrivateControl(state.path, state.identity, '{"stageStatus":"stopped"}\n'), /identity changed/);
  assert.equal(await readFile(state.path, 'utf8'), replacement);
  assert.deepEqual(await readdir(state.parent), ['control.json']);
});

test('oversized serialization is rejected before creating a temporary file or changing the checkpoint', async t => {
  const state = await fixture(t);
  await assert.rejects(replacePrivateControl(state.path, state.identity, 'x'.repeat(16 * 1024 + 1)), /16384-byte limit/);
  assert.deepEqual(await readFile(state.path), state.original);
  assert.deepEqual(await readdir(state.parent), ['control.json']);
});

test('a replacement appearing before commit is preserved and the stale write is refused', async t => {
  const state = await fixture(t);
  const external = '{"stageStatus":"external-owned-replacement"}\n';
  await assert.rejects(replacePrivateControl(state.path, state.identity, '{"stageStatus":"running"}\n', {
    beforeRename: async () => {
      const other = join(state.parent, 'other.json');
      await writeFile(other, external, { flag: 'wx', mode: 0o600 });
      await rename(other, state.path);
    },
  }), /identity changed/);
  assert.equal(await readFile(state.path, 'utf8'), external);
  assert.deepEqual(await readdir(state.parent), ['control.json']);
});
