import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { acquireAdmin1Source, ADMIN1_CAPTURE_LIMITS, validateAdmin1CaptureSpec } from './admin1-acquire.ts';
import type { Admin1CaptureSpec } from './admin1-types.ts';

const release='a'.repeat(40), artifact='geojson/ne_10m_admin_1_states_provinces.geojson';
const metadataPath='.cache/world-build/evidence/admin1-resolution-research/source-api.json';
const rawUrl=(rev:string)=>`https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${rev}/${artifact}`;
const blob=(bytes:Uint8Array)=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const api=`https://api.github.com/repos/nvkelso/natural-earth-vector`;

async function fixture<T>(run:(root:string,raw:Buffer,spec:Admin1CaptureSpec)=>Promise<T>,raw=Buffer.from('synthetic Admin1 bytes; not Natural Earth geometry')):Promise<T>{
  const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'admin1-acquire-'));
  try{const spec=await writeMetadata(root,raw);return await run(root,raw,spec);}finally{await rm(root,{recursive:true,force:true});}
}
async function writeMetadata(root:string,raw:Buffer,revision=release):Promise<Admin1CaptureSpec>{
  const digest=blob(raw),url=rawUrl(revision),git=`${api}/git/blobs/${digest}`,contentUrl=`${api}/contents/${artifact}?ref=${revision}`,html=`https://github.com/nvkelso/natural-earth-vector/blob/${revision}/${artifact}`;
  const metadata=Buffer.from(JSON.stringify({name:'ne_10m_admin_1_states_provinces.geojson',path:artifact,sha:digest,size:raw.length,encoding:'none',content:'',type:'file',download_url:url,git_url:git,url:contentUrl,html_url:html,_links:{self:contentUrl,git,html}}));
  const filename=path.join(root,metadataPath);await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,metadata,{mode:0o600});
  return{schemaVersion:1,provider:'natural-earth',release:revision,resolution:'10m',metadataPath,metadataSha256:sha(metadata),metadataBytes:metadata.length,expectedBytes:raw.length,expectedGitBlobSha1:digest,license:'Public-domain',attribution:'SYNTHETIC FIXTURE ONLY'};
}
function response(raw:Buffer,status=200,headers:Record<string,string>={},url=rawUrl(release)):Response{const result=new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(raw.subarray(0,Math.min(5,raw.length))));if(raw.length>5)c.enqueue(new Uint8Array(raw.subarray(5)));c.close();}}),{status,headers});Object.defineProperty(result,'url',{value:url});return result;}
async function audit(root:string):Promise<Array<Record<string,unknown>>>{const file=path.join(root,'.cache/world-build/admin1-source-cache/network-audit.jsonl');return(await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>);}

test('validates fixed Natural Earth Admin1 artifact scope and caps',async()=>fixture(async(_root,_raw,spec)=>{
  assert.deepEqual(validateAdmin1CaptureSpec(spec),spec);
  assert.throws(()=>validateAdmin1CaptureSpec({...spec,release:'abcd'}));
  assert.throws(()=>validateAdmin1CaptureSpec({...spec,metadataPath:'../outside'}));
  assert.throws(()=>validateAdmin1CaptureSpec({...spec,expectedBytes:ADMIN1_CAPTURE_LIMITS.sourceBytes+1}));
  assert.throws(()=>validateAdmin1CaptureSpec({...spec,expectedGitBlobSha1:'A'.repeat(40)}));
}));

test('captures a synthetic pinned stream, verifies SHA and Git blob, then cache-hits without network',async()=>fixture(async(root,raw,spec)=>{
  let calls=0;const fetcher:typeof fetch=async(input,init)=>{calls++;assert.equal(String(input),rawUrl(release));assert.equal(init?.redirect,'manual');assert.equal(new Headers(init?.headers).get('accept-encoding'),'identity');return response(raw);};
  const first=await acquireAdmin1Source(spec,{repositoryRoot:root,fetcher});assert.equal(first.networkBytes,raw.length);assert.equal(first.source.sha256,sha(raw));assert.equal(first.source.bytes,raw.length);assert.equal(first.source.id,`natural-earth-admin1-10m-${release}`);assert.deepEqual(await readFile(first.inputPath),raw);
  const receipt=JSON.parse(await readFile(first.receiptPath,'utf8')) as Record<string,unknown>;assert.equal(receipt.gitBlobSha1,blob(raw));assert.equal(receipt.evidence,'exact-pinned-response-hash-verified');
  const hit=await acquireAdmin1Source(spec,{repositoryRoot:root,fetcher:async()=>{throw new Error('cache hit contacted network');}});assert.equal(hit.cacheHit,true);assert.equal(hit.networkBytes,0);assert.equal(hit.requestHash,first.requestHash);assert.equal(calls,1);
}));

test('metadata tampering, wrong pinned fields, redirects and content encoding fail before accepting bytes',async()=>fixture(async(root,raw,spec)=>{
  let calls=0;const f:typeof fetch=async()=>{calls++;return response(raw);};
  const file=path.join(root,metadataPath),original=await readFile(file);
  const altered=Buffer.from(original.toString().replace(spec.expectedGitBlobSha1,'0'.repeat(40)));await writeFile(file,altered);
  await assert.rejects(acquireAdmin1Source(spec,{repositoryRoot:root,fetcher:f}),/metadata does not match/);assert.equal(calls,0);await writeFile(file,original);
  await assert.rejects(acquireAdmin1Source(spec,{repositoryRoot:root,fetcher:async()=>response(raw,302)}),/HTTP 302/);
  const failed=(await audit(root)).at(-1)!;assert.equal(failed.event,'finish');assert.equal(failed.measured,null);assert.equal(failed.reservation,raw.length+ADMIN1_CAPTURE_LIMITS.overshootBytes);
  await fixture(async(r,b,s)=>{await assert.rejects(acquireAdmin1Source(s,{repositoryRoot:r,fetcher:async()=>response(b,200,{'content-encoding':'gzip'})}),/identity encoding/);});
}));

test('partial interruption retains full reservation; corrupt source, receipt, and audit fail closed',async()=>fixture(async(root,raw,spec)=>{
  const partialFetcher:typeof fetch=async()=>{let delivered=false;const r=new Response(new ReadableStream<Uint8Array>({pull(c){if(!delivered){delivered=true;c.enqueue(new Uint8Array(raw.subarray(0,7)));}else c.error(new Error('fixture stream interrupted'));}}),{status:200});Object.defineProperty(r,'url',{value:rawUrl(release)});return r;};
  await assert.rejects(acquireAdmin1Source(spec,{repositoryRoot:root,fetcher:partialFetcher}),/fixture stream interrupted/);
  const rows=await audit(root),start=rows.find(x=>x.event==='start')!,finish=rows.find(x=>x.event==='finish')!;assert.equal(start.reservation,raw.length+ADMIN1_CAPTURE_LIMITS.overshootBytes);assert.equal(finish.complete,false);assert.equal(finish.measured,7);assert.equal(finish.reservation,start.reservation);
  await assert.rejects(acquireAdmin1Source(spec,{repositoryRoot:root,fetcher:partialFetcher}),/fixture stream interrupted/);
  await assert.rejects(acquireAdmin1Source(spec,{repositoryRoot:root,fetcher:partialFetcher}),/attempt limit/);
}));

test('lifetime network reservations span distinct hashes and prevent a third 32 MiB attempt',async()=>{
  const root=await mkdtemp(path.join(await realpath(os.tmpdir()),'admin1-lifetime-'));
  try{
    const placeholder=Buffer.from('x');const specs:Admin1CaptureSpec[]=[];
    for(const rev of ['1'.repeat(40),'2'.repeat(40),'3'.repeat(40)]){const spec=await writeMetadata(root,placeholder,rev);const large={...spec,expectedBytes:32*1024*1024};
      specs.push(large);
    }
    for(const spec of specs.slice(0,2)){
      await writeMetadata(root,placeholder,spec.release);
      const metadataFile=path.join(root,metadataPath),m=JSON.parse(await readFile(metadataFile,'utf8')) as Record<string,unknown>;m.sha=spec.expectedGitBlobSha1;m.size=spec.expectedBytes;
      const adjusted=Buffer.from(JSON.stringify(m));await writeFile(metadataFile,adjusted);spec.metadataSha256=sha(adjusted);spec.metadataBytes=adjusted.length;
      await assert.rejects(acquireAdmin1Source(spec,{repositoryRoot:root,fetcher:async()=>{throw new Error('synthetic network interruption');}}),/synthetic network interruption/);
    }
    const third=specs[2]!;await writeMetadata(root,placeholder,third.release);const metadataFile=path.join(root,metadataPath),m=JSON.parse(await readFile(metadataFile,'utf8')) as Record<string,unknown>;m.sha=third.expectedGitBlobSha1;m.size=third.expectedBytes;const adjusted=Buffer.from(JSON.stringify(m));await writeFile(metadataFile,adjusted);third.metadataSha256=sha(adjusted);third.metadataBytes=adjusted.length;
    await assert.rejects(acquireAdmin1Source(third,{repositoryRoot:root,fetcher:async()=>{throw new Error('must be blocked before transport');}}),/cumulative 96 MiB/);
    assert.equal((await audit(root)).filter(x=>x.event==='start').length,2);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('cache and metadata symlink paths are refused without writing through them',async()=>fixture(async(root,raw,spec)=>{
  const outer=await mkdtemp(path.join(await realpath(os.tmpdir()),'admin1-link-'));
  try{const repo=path.join(outer,'repo'),outside=path.join(outer,'outside');await mkdir(repo);await mkdir(outside);await symlink(outside,path.join(repo,'.cache'));await assert.rejects(acquireAdmin1Source(spec,{repositoryRoot:repo,fetcher:async()=>response(raw)}),/unsafe ancestor|symlink/);assert.deepEqual(await (await import('node:fs/promises')).readdir(outside),[]);}finally{await rm(outer,{recursive:true,force:true});}
}));

test('cached payload or receipt tampering is retained and never repaired by another fetch',async()=>fixture(async(root,raw,spec)=>{
  const first=await acquireAdmin1Source(spec,{repositoryRoot:root,fetcher:async()=>response(raw)});const altered=Buffer.from(raw);altered[0]=altered[0]!^1;await writeFile(first.inputPath,altered);let calls=0;
  await assert.rejects(acquireAdmin1Source(spec,{repositoryRoot:root,fetcher:async()=>{calls++;return response(raw);}}),/cached source size\/Git blob mismatch/);assert.equal(calls,0);
  await fixture(async(r,b,pin)=>{const captured=await acquireAdmin1Source(pin,{repositoryRoot:r,fetcher:async()=>response(b)});await writeFile(captured.receiptPath,'{}\n');await assert.rejects(acquireAdmin1Source(pin,{repositoryRoot:r,fetcher:async()=>{throw new Error('corrupt receipt must not refetch');}}),/receipt does not bind exact cached source/);});
}));

test('verified source with missing receipt is restored with explicit cache-only provenance',async()=>fixture(async(root,raw,spec)=>{
  const first=await acquireAdmin1Source(spec,{repositoryRoot:root,fetcher:async()=>response(raw)});await unlink(first.receiptPath);
  const restored=await acquireAdmin1Source(spec,{repositoryRoot:root,cacheOnly:true,fetcher:async()=>{throw new Error('receipt recovery must not fetch');}});
  assert.equal(restored.cacheHit,true);assert.equal(restored.networkBytes,0);const receipt=JSON.parse(await readFile(restored.receiptPath,'utf8')) as Record<string,unknown>;
  assert.equal(receipt.evidence,'verified-existing-git-blob-cache');assert.equal(receipt.observedHttpStatus,null);assert.equal(receipt.networkBytes,0);
}));

test('abort deadline and delivered-byte overshoot remain bounded and durably charged',async()=>fixture(async(root,raw,spec)=>{
  const controller=new AbortController();
  const abortAware:typeof fetch=async(_input,init)=>new Promise<Response>((_resolve,reject)=>{const signal=init?.signal;setImmediate(()=>controller.abort(new Error('fixture post-start abort')));if(signal?.aborted)reject(signal.reason);else signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  await assert.rejects(acquireAdmin1Source(spec,{repositoryRoot:root,signal:controller.signal,fetcher:abortAware}),/fixture post-start abort/);
  const result=await audit(root);assert.equal(result.at(-1)?.status,'failure');assert.equal(result.at(-1)?.measured,null);assert.equal(result.at(-1)?.complete,false);
  await fixture(async(r,bytes,pin)=>{
    let calls=0;const began=Date.now();
    await assert.rejects(acquireAdmin1Source(pin,{repositoryRoot:r,durationMs:1,fetcher:async()=>{calls++;return response(bytes);}}),/deadline|wait aborted/);
    assert.ok(Date.now()-began<1000);assert.ok(calls<=1);
    try{const events=await audit(r);assert.equal(events.at(-1)?.event,'finish');}catch(error){if(!(error instanceof Error)||!(/ENOENT/.test(error.message)))throw error;}
  });
  await fixture(async(r,bytes,pin)=>{
    const oversized=new Uint8Array(bytes.length+ADMIN1_CAPTURE_LIMITS.overshootBytes+1);oversized.set(bytes);
    await assert.rejects(acquireAdmin1Source(pin,{repositoryRoot:r,fetcher:async()=>response(Buffer.from(oversized))}),/exceeded reserved network allowance/);
    const terminal=(await audit(r)).at(-1)!;assert.equal(terminal.complete,false);assert.equal(terminal.measured,oversized.length);assert.equal(terminal.reservation,oversized.length);
  },Buffer.from('tiny'));
}));

test('truncated or invalid UTF-8 aggregate audit blocks capture and verified cache use',async()=>fixture(async(root,raw,spec)=>{
  const cache=path.join(root,'.cache/world-build/admin1-source-cache');await mkdir(cache,{recursive:true});await appendFile(path.join(cache,'network-audit.jsonl'),Buffer.from([0xff,0x0a]));
  await assert.rejects(acquireAdmin1Source(spec,{repositoryRoot:root,fetcher:async()=>{throw new Error('audit should fail first');}}),/not valid UTF-8/);
}));
