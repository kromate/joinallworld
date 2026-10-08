import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import { readCountryDirectory, readCountryDirectoryCountry } from './country-directory-reader.ts';
import type { CountryDirectoryManifest } from './country-directory-types.ts';
import type { SourceRecord } from './types.ts';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}
function pin(raw: Buffer, release: string): SourceRecord { return { id:`directory-reader-${release}`, url:`https://example.invalid/${release}.json`,release,license:'Public-domain',attribution:'Synthetic fixture only',sha256:sha(raw),bytes:raw.length }; }
function fixtureRaw(): Buffer {
  const poly = (x: number) => ({ type:'Polygon',coordinates:[[[x,4],[x+1,4],[x+1,5],[x,5],[x,4]]] });
  return Buffer.from(JSON.stringify({type:'FeatureCollection',features:[
    {type:'Feature',properties:{NE_ID:1,ADMIN:'Synthetic Ghana',CONTINENT:'Africa',ISO_A2_EH:'GH'},geometry:poly(-3)},
    {type:'Feature',properties:{NE_ID:159,ADMIN:'Nigeria',CONTINENT:'Africa',ISO_A2_EH:'NG'},geometry:poly(3)},
  ]}));
}
async function setup(): Promise<{ root:string; output:string; manifestHash:string; manifest:CountryDirectoryManifest }> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(),'country-directory-reader-')));
  const raw = fixtureRaw(), source = pin(raw,'a'.repeat(40)), baseline = pin(raw,'b'.repeat(40));
  const compiled = compileCountryDirectory(source,raw,baseline,raw,sha('baseline inventory manifest'));
  const output = path.join(root,'output','country-inventory');
  await publishCountryDirectory(compiled,output,path.join(root,'output'));
  return {root,output,manifestHash:compiled.manifestHash,manifest:compiled.manifest};
}
async function writeManifest(output: string, manifest: CountryDirectoryManifest): Promise<string> {
  const body = Buffer.from(canonical(manifest)), hash = sha(body);
  await mkdir(path.join(output,'manifests'),{recursive:true});
  await writeFile(path.join(output,'manifests',`${hash}.json`),body);
  return hash;
}
async function writeNodeIndex(output: string, value: unknown): Promise<string> {
  const body = Buffer.from(canonical(value)), hash = sha(body);
  await mkdir(path.join(output,'nodes'),{recursive:true});
  await writeFile(path.join(output,'nodes',`${hash}.json`),body);
  return `nodes/${hash}.json`;
}
async function withSetup(run: (state: Awaited<ReturnType<typeof setup>>) => Promise<void>): Promise<void> {
  const state = await setup();
  try { await run(state); } finally { await rm(state.root,{recursive:true,force:true}); }
}

test('reads and validates the complete bounded hierarchy, identity, outline indexes, and protected Nigeria', async () => withSetup(async state => {
  const value = await readCountryDirectory(state.output,state.manifestHash);
  assert.equal(value.manifestHash,state.manifestHash);
  assert.equal(value.nodes.length,state.manifest.nodeCount);
  assert.equal(value.nodes.filter(node=>node.kind==='country').length,2);
  assert.equal(value.nodes.find(node=>node.id==='legacy-ng')!.outline,'missing');
  const ghana = await readCountryDirectoryCountry(state.output,state.manifestHash,'GH');
  assert.equal(ghana.id,'country:natural-earth:NE_ID%3A1');
  await assert.rejects(readCountryDirectoryCountry(state.output,state.manifestHash,'NG'),/protected legacy/);
  await assert.rejects(readCountryDirectoryCountry(state.output,state.manifestHash,'ZZ'),/exactly one/);
}));

test('refuses ambiguous ISO-2 lookup even when each source identity is valid', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(),'country-directory-ambiguous-')));
  try {
    const poly = (x: number) => ({type:'Polygon',coordinates:[[[x,4],[x+1,4],[x+1,5],[x,5],[x,4]]]});
    const raw = Buffer.from(JSON.stringify({type:'FeatureCollection',features:[
      {type:'Feature',properties:{NE_ID:1,ADMIN:'Ghana A',CONTINENT:'Africa',ISO_A2_EH:'GH'},geometry:poly(-3)},
      {type:'Feature',properties:{NE_ID:2,ADMIN:'Ghana B',CONTINENT:'Africa',ISO_A2_EH:'GH'},geometry:poly(-2)},
      {type:'Feature',properties:{NE_ID:159,ADMIN:'Nigeria',CONTINENT:'Africa',ISO_A2_EH:'NG'},geometry:poly(3)},
    ]}));
    const compiled = compileCountryDirectory(pin(raw,'a'.repeat(40)),raw,pin(raw,'b'.repeat(40)),raw,sha('baseline'));
    const output = path.join(root,'output','country-inventory');
    await publishCountryDirectory(compiled,output,path.join(root,'output'));
    await assert.rejects(readCountryDirectoryCountry(output,compiled.manifestHash,'GH'),/exactly one/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('rejects tampered content hashes and symlinked hierarchy assets', async () => withSetup(async state => {
  const manifestFile = path.join(state.output,'manifests',`${state.manifestHash}.json`);
  const original = await readFile(manifestFile);
  await writeFile(manifestFile,Buffer.from('tampered'));
  await assert.rejects(readCountryDirectory(state.output,state.manifestHash),/hash mismatch/);
  await writeFile(manifestFile,original);
  const outside = path.join(state.root,'outside.json');
  await writeFile(outside,original);
  await rm(manifestFile);
  await symlink(outside,manifestFile);
  await assert.rejects(readCountryDirectory(state.output,state.manifestHash),/symlink|non-regular/);
}));

test('rejects duplicate child indexes, missing hierarchy references, and forged counts', async () => withSetup(async state => {
  const rootPath = state.manifest.rootNodePath;
  const rootFile = path.join(state.output,rootPath);
  const rootIndex = JSON.parse((await readFile(rootFile)).toString('utf8')) as { children:Array<{id:string;name:string;path:string}>; [key:string]:unknown };
  const duplicateRootPath = await writeNodeIndex(state.output,{...rootIndex,children:[...rootIndex.children,rootIndex.children[0]]});
  const duplicateManifest = { ...state.manifest, rootNodePath:duplicateRootPath };
  const duplicateHash = await writeManifest(state.output,duplicateManifest);
  await assert.rejects(readCountryDirectory(state.output,duplicateHash),/children are duplicated/);

  const missingRootPath = await writeNodeIndex(state.output,{...rootIndex,children:rootIndex.children.slice(1)});
  const missingManifest = { ...state.manifest, rootNodePath:missingRootPath };
  const missingHash = await writeManifest(state.output,missingManifest);
  await assert.rejects(readCountryDirectory(state.output,missingHash),/denominator|rollup|outline|node or source-unit/);

  const wrongCountHash = await writeManifest(state.output,{...state.manifest,nodeCount:state.manifest.nodeCount+1});
  await assert.rejects(readCountryDirectory(state.output,wrongCountHash),/node count|denominator/);
}));

test('honors cancellation before any local reads', async () => withSetup(async state => {
  const controller = new AbortController(); controller.abort(new Error('synthetic stop'));
  await assert.rejects(readCountryDirectory(state.output,state.manifestHash,controller.signal),/synthetic stop/);
  assert.ok((await lstat(path.join(state.output,'manifests',`${state.manifestHash}.json`))).isFile());
}));
