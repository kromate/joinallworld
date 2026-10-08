import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishPreparedStages } from '../scripts/street/publish.ts';
import { createStreetAssets } from './street/assets.ts';
import { nodeStreetAssets } from './street/node-assets.ts';

function full(version: string) { return JSON.stringify({ v: 1, city: 'lagos', version, tileSize: 128, quantum: 100, groundCell: 2, mapFrame: { origin: {x:0,z:0}, unitsPerKm:10 }, tiles: [], doors: [], issues: [] }); }
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'allworld-street-pointer-')); t.after(() => rm(root, {recursive:true,force:true}));
  const output = join(root, 'stage'), publicRoot = join(root, 'public'), distRoot = join(root, 'dist'), cityRoot = join(publicRoot, 'assets/street/lagos');
  await mkdir(output, {recursive:true});await mkdir(cityRoot, {recursive:true});
  const text = full('street-v1-new'); await writeFile(join(output,'manifest.txt'),text); await writeFile(join(output,'manifest-street-v1-new.txt'),text);
  return { output,publicRoot,distRoot,cityRoot,text,stage:{city:'lagos',output,packs:0,emittedTiles:0,manifestBytes:text.length,maxPackRaw:0,maxPackBrotli:0} };
}
test('local publication switches a small pointer after immutable data, preserves prior journeys and keeps retention on retry',async t=>{
  const f=await fixture(t),old=full('street-v1-old');
  await writeFile(join(f.cityRoot,'manifest.txt'),old);await writeFile(join(f.cityRoot,'manifest-street-v1-old.txt'),old);
  await publishPreparedStages([f.stage],f);
  assert.deepEqual(JSON.parse(await readFile(join(f.cityRoot,'manifest.txt'),'utf8')),{p:1,city:'lagos',targetVersion:'street-v1-new'});
  assert.equal(await readFile(join(f.cityRoot,'manifest-street-v1-new.txt'),'utf8'),f.text);
  const assets=createStreetAssets(nodeStreetAssets([join(f.publicRoot,'assets/street')]));
  assert.equal((await assets.manifest('lagos')).version,'street-v1-new');
  assert.equal((await assets.manifest('lagos','street-v1-old')).version,'street-v1-old');
  await publishPreparedStages([f.stage],f);
  assert.equal(JSON.parse(await readFile(join(f.cityRoot,'retained.txt'),'utf8')).previous,'street-v1-old');
  assert.equal(await readFile(join(f.cityRoot,'manifest-street-v1-old.txt'),'utf8'),old);
});
test('publication cannot switch the current entry when the immutable target is missing or differs',async t=>{
  const f=await fixture(t),old=full('street-v1-old');await writeFile(join(f.cityRoot,'manifest.txt'),old);
  await rm(join(f.output,'manifest-street-v1-new.txt'));
  await assert.rejects(publishPreparedStages([f.stage],f)); assert.equal(await readFile(join(f.cityRoot,'manifest.txt'),'utf8'),old);
  await writeFile(join(f.output,'manifest-street-v1-new.txt'),full('street-v1-wrong'));
  await assert.rejects(publishPreparedStages([f.stage],f),/differs/);assert.equal(await readFile(join(f.cityRoot,'manifest.txt'),'utf8'),old);
});
