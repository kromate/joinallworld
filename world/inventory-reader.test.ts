import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildInventory, publishInventory } from './inventory.ts';
import { readBoundedLocalFile, readCoarseInventoryCountry } from './inventory-reader.ts';
import type { SourceRecord } from './types.ts';

const source: SourceRecord = {id:'test-source',url:'https://example.invalid',release:'synthetic',license:'test',attribution:'synthetic only',sha256:'a'.repeat(64),bytes:1};
const feature = (id: number, code: string) => ({type:'Feature',properties:{NE_ID:id,ADMIN:code,CONTINENT:'Africa',ISO_A2_EH:code},geometry:{type:'Polygon',coordinates:[[[29,-3],[31,-3],[31,-1],[29,-1],[29,-3]]]}});
async function fixture(run: (root: string, hash: string) => Promise<void>, duplicate = false) {
  const temporary = await mkdtemp(path.join(os.tmpdir(),'world-coarse-reader-'));
  try {
    const root = path.join(await realpath(temporary),'output','inventory');
    const inventory = buildInventory(source,{type:'FeatureCollection',features:[feature(1,'RW'),feature(2,'NG'),...(duplicate?[feature(3,'RW')]:[])]});
    const result = await publishInventory(inventory,root,await realpath(temporary));
    await run(root,result.manifestHash);
  } finally { await rm(temporary,{recursive:true,force:true}); }
}
test('reader verifies frozen hierarchy and binds only one world country, protecting Nigeria',async()=>fixture(async(root,hash)=>{
  const node=await readCoarseInventoryCountry(root,hash,'RW');
  assert.equal(node.id,'country:natural-earth:NE_ID%3A1');
  assert.deepEqual(node.sourceFeatureIds,['test-source:NE_ID:1']);
  await assert.rejects(readCoarseInventoryCountry(root,hash,'NG'),/protected/);
  await assert.rejects(readCoarseInventoryCountry(root,hash,'GH'),/exactly one/);
}));
test('reader refuses duplicate code mapping and a valid-hash manifest with wrong denominator',async()=>{
  await fixture(async(root,hash)=>assert.rejects(readCoarseInventoryCountry(root,hash,'RW'),/exactly one/),true);
  await fixture(async(root,hash)=>{
    const manifest=JSON.parse(await readFile(path.join(root,'manifests',`${hash}.json`),'utf8')) as {sourceUnitCount:number};
    manifest.sourceUnitCount++;
    const body=JSON.stringify(manifest),newHash=createHash('sha256').update(body).digest('hex');
    await writeFile(path.join(root,'manifests',`${newHash}.json`),body);
    await assert.rejects(readCoarseInventoryCountry(root,newHash,'RW'),/denominator/);
  });
});
test('reader rejects tampering and symlink ancestors before reading hierarchy',async()=>fixture(async(root,hash)=>{
  const file=path.join(root,'manifests',`${hash}.json`),original=await readFile(file);
  await writeFile(file,Buffer.concat([original,Buffer.from(' ')]));
  await assert.rejects(readCoarseInventoryCountry(root,hash,'RW'),/hash mismatch/);
  await writeFile(file,original);
  const link=path.join(path.dirname(root),'linked');await symlink(root,link);
  await assert.rejects(readCoarseInventoryCountry(link,hash,'RW'),/symlink/);
  await assert.rejects(readBoundedLocalFile(file,1),/byte limit/);
}));
