import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadFinePromotionSelections } from './fine-promotion-cli.ts';

async function fixture(run: (root: string, filename: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'promotion-config-'));
  try { await mkdir(path.join(root, 'world')); await run(root, path.join(root, 'world/pilots.json')); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const config = () => ({ schemaVersion: 1, catalogueHash: 'a'.repeat(64), selections: [{ countryId: 'country:pilot', countryIso3: 'DJI', commit: 'b'.repeat(40) }] });
test('explicit configuration retains catalogue and immutable selection identities', async () => fixture(async (root, file) => {
  await writeFile(file, JSON.stringify(config()));
  assert.deepEqual(await loadFinePromotionSelections(root, 'world/pilots.json'), { catalogueHash: config().catalogueHash, selections: config().selections });
}));
test('configuration fails closed on changed shape, repeated country, invalid commit and excess pilots', async () => fixture(async (root, file) => {
  for (const value of [
    { ...config(), execute: 'arbitrary command' },
    { ...config(), selections: [config().selections[0], config().selections[0]] },
    { ...config(), selections: [{ ...config().selections[0], commit: 'main' }] },
    { ...config(), selections: Array.from({ length: 17 }, () => config().selections[0]) },
  ]) { await writeFile(file, JSON.stringify(value)); await assert.rejects(loadFinePromotionSelections(root, 'world/pilots.json')); }
}));
test('configuration read rejects traversal, symlinks and oversized input', async () => fixture(async (root, file) => {
  await assert.rejects(loadFinePromotionSelections(root, 'world/../outside.json'));
  const outside = path.join(root, 'outside.json'); await writeFile(outside, JSON.stringify(config()));
  await symlink(outside, file); await assert.rejects(loadFinePromotionSelections(root, 'world/pilots.json'), /symlink/);
  await rm(file); await writeFile(file, Buffer.alloc(64 * 1024 + 1, 32));
  await assert.rejects(loadFinePromotionSelections(root, 'world/pilots.json'), /limit|exceed|large|size/i);
}));
