// Fixed, source-pinned audit of a private WAL-aware copy. Original SQLite is never opened.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, readdirSync, type Stats } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { auditFeatureIndexConnection, type AuditCaptureInput } from '../feature-index-audit.ts';
import { FEATURE_INDEX_STORAGE_CONTRACT, featureIndexObservationPin, type FeatureIndexLimits, type FeatureIndexObservation } from '../feature-index.ts';
import { CAPTURE_BINDING_VERSION, type CaptureBytePin, type CaptureExpectation } from '../capture-binding.ts';
import { CAPTURE_REQUEST_COMPILER } from '../capture-request.ts';
import { parseCaptureJson } from '../capture-json.ts';
import { canonicalJson, sha256 } from '../pack.ts';
import { privateDescriptor, privatePath, validateRootAndLeases, captureBytes } from './index_ingest.ts';

const SHA=/^[a-f0-9]{64}$/;
const MAX_INPUT=512000;
type Row=Record<string,unknown>;
function object(value:unknown,keys:string[],label:string):Row {
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),`${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),`${label} fields differ`);
  return value as Row;
}
function integer(value:unknown,min:number,max:number,label:string):number {
  assert.ok(typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max,`${label} exceeds bounds`);return value;
}
function digest(value:unknown,label:string):string {assert.ok(typeof value==='string'&&SHA.test(value),`${label} hash differs`);return value;}
function pin(value:unknown,max:number,label:string,minimum=1):CaptureBytePin {
  const v=object(value,['bytes','sha256'],label);return {bytes:integer(v.bytes,minimum,max,label),sha256:digest(v.sha256,label)};
}
function descriptor(value:string|undefined,label:string):number {
  assert.ok(value&&/^[0-9]{1,10}$/.test(value),`${label} descriptor invalid`);return integer(Number(value),3,2147483647,label);
}
function signature(info:Stats):string {
  return [info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs,info.uid,info.mode,info.nlink].join(':');
}
function canonicalPath(value:unknown,label:string):string {
  assert.ok(typeof value==='string'&&value.length<=4096&&/^[\x20-\x7e]+$/.test(value)&&!value.includes('\\')&&path.isAbsolute(value)&&realpathSync(value)===value,`${label} path differs`);return value;
}
function streamPin(file:string,expected:CaptureBytePin):string {
  const before=lstatSync(file);assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.uid===process.getuid!()&&before.nlink===1&&(before.mode&0o777)===0o600&&before.size===expected.bytes,'Snapshot file differs');
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    assert.equal(signature(fstatSync(fd)),signature(before));const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let offset=0;
    while(offset<expected.bytes){const count=readSync(fd,buffer,0,Math.min(buffer.length,expected.bytes-offset),offset);assert.ok(count>0,'Snapshot shortened');hash.update(buffer.subarray(0,count));offset+=count;}
    assert.equal(hash.digest('hex'),expected.sha256,'Snapshot hash differs');assert.equal(signature(fstatSync(fd)),signature(before));assert.equal(signature(lstatSync(file)),signature(before));
    return signature(before);
  }finally{closeSync(fd);}
}
function rawBytes(value:unknown,expected:CaptureBytePin,maximum:number,label:string):Buffer {
  const file=canonicalPath(value,label),before=lstatSync(file);
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{assert.equal(signature(fstatSync(fd)),signature(before));const bytes=captureBytes(fd,expected,maximum,label);assert.equal(signature(lstatSync(file)),signature(before));return bytes;}finally{closeSync(fd);}
}
function expectedBytes(value:unknown,ownedPin:CaptureBytePin):CaptureExpectation {
  assert.ok(typeof value==='string'&&value.length<=85336&&/^[A-Za-z0-9+/]*={0,2}$/.test(value),'Expected base64 differs');
  const raw=Buffer.from(value,'base64');assert.equal(raw.toString('base64'),value);assert.equal(raw.length,ownedPin.bytes);assert.equal(sha256(raw),ownedPin.sha256);
  const expected=object(parseCaptureJson(raw,{bytes:64000,nodes:20000,depth:32}),['requestHash','request','extract','receipt'],'Expected capture');
  digest(expected.requestHash,'Request');pin(expected.extract,20000000,'Extract');pin(expected.receipt,1000000,'Receipt');
  return expected as unknown as CaptureExpectation;
}
function compareContexts(contexts:unknown,allowedPins:unknown,attempts:Row[]):{required:FeatureIndexObservation[];allowed:CaptureBytePin[]} {
  assert.ok(Array.isArray(contexts)&&contexts.length<=8&&Array.isArray(allowedPins)&&allowedPins.length<=8,'Context count differs');
  const allowed=(allowedPins as unknown[]).map(p=>pin(p,4096,'Observation'));
  const actual=new Map<string,CaptureBytePin>();
  for(const attempt of attempts){assert.equal(attempt.phase,'terminal','Prepared attempt cannot be audited');if(attempt.observation!=null){const p=pin(attempt.observation,4096,'Attempt context');actual.set(`${p.sha256}:${p.bytes}`,p);}}
  const keys=allowed.map(p=>`${p.sha256}:${p.bytes}`);assert.equal(new Set(keys).size,keys.length,'Duplicate allowable pin');assert.deepEqual([...keys].sort(),[...actual.keys()].sort(),'Allowable pins differ from capture ownership');
  const required=(contexts as unknown[]).map(value=>{const v=object(value,['campaignHash','planHash','jobId','rootCellId','queryPath'],'Required context') as unknown as FeatureIndexObservation;const p=featureIndexObservationPin(v);assert.ok(actual.has(`${p.sha256}:${p.bytes}`),'Required context is not owned');return v;});
  return {required,allowed};
}

export function auditFeatureIndexWorker():Row {
  assert.equal(process.argv.length,2,'Audit accepts no CLI arguments');
  const root=canonicalPath(process.env.TMPDIR,'Index root');
  const inputFd=descriptor(process.env.WORLD_INDEX_AUDIT_DESCRIPTOR,'Audit'),leaseFd=descriptor(process.env.WORLD_INDEX_LEASE_DESCRIPTOR,'Writer'),namespaceFd=descriptor(process.env.WORLD_INDEX_NAMESPACE_DESCRIPTOR,'Namespace');
  assert.equal(new Set([inputFd,leaseFd,namespaceFd]).size,3);
  const leases=validateRootAndLeases(root,leaseFd,namespaceFd);
  const rawInput=privateDescriptor(inputFd,MAX_INPUT,'Audit envelope'),inputSha=sha256(rawInput);
  assert.equal(inputSha,digest(process.env.WORLD_INDEX_AUDIT_SHA256,'Audit envelope'));
  const envelope=object(parseCaptureJson(rawInput,{bytes:MAX_INPUT,nodes:200000,depth:32}),['format','indexHash','captureRecord','snapshotRoot','database','wal','captures'],'Audit envelope');
  assert.equal(envelope.format,'feature-index-audit-input-v1');assert.equal(envelope.indexHash,path.basename(root));
  const bindingRaw=privatePath(path.join(root,'binding.json'),4096,0o600,'Index binding');assert.equal(sha256(bindingRaw),envelope.indexHash);
  const binding=object(parseCaptureJson(bindingRaw,{bytes:4096,nodes:1000,depth:16}),['format','engineVersion','identityVersion','captureVersion','sourceCompiler','source','toolingManifest','runtime','engineLimits','processLimits','reservedBytes'],'Index binding');
  assert.equal(binding.format,'feature-index-binding-v1');assert.equal(binding.engineVersion,FEATURE_INDEX_STORAGE_CONTRACT.version);assert.equal(binding.identityVersion,FEATURE_INDEX_STORAGE_CONTRACT.identityVersion);assert.equal(binding.captureVersion,CAPTURE_BINDING_VERSION);assert.equal(binding.sourceCompiler,CAPTURE_REQUEST_COMPILER);
  const runtime=binding.runtime as Row;assert.equal(runtime.nodeVersion,process.version);assert.equal(runtime.sqliteVersion,process.versions.sqlite);
  const source=binding.source as Row,sourcePin=pin(source.configuration,64000,'Configuration');
  const sourceBytes=privatePath(fileURLToPath(new URL('../acquisition-sources.json',import.meta.url)),64000,0o400,'Configuration');assert.equal(sourceBytes.length,sourcePin.bytes);assert.equal(sha256(sourceBytes),sourcePin.sha256);
  const sourceConfig=parseCaptureJson(sourceBytes,{bytes:64000,nodes:1000,depth:8}) as Row;assert.equal(sourceConfig.provider,source.provider);assert.equal(sourceConfig.release,source.release);
  const recordPin=pin(envelope.captureRecord,512000,'Capture record'),recordRaw=privatePath(path.join(root,'capture.json'),512000,0o600,'Capture record');assert.equal(recordRaw.length,recordPin.bytes);assert.equal(sha256(recordRaw),recordPin.sha256);
  const record=parseCaptureJson(recordRaw,{bytes:512000,nodes:100000,depth:20}) as Row;assert.ok(record.format==='feature-index-capture-controller-v1'||record.format==='feature-index-capture-controller-v2');assert.equal((record.index as Row).indexHash,envelope.indexHash);
  const index=object(record.index,['indexHash','rootDevice','rootInode','lockDevice','lockInode'],'Capture index'),held=fstatSync(leaseFd,{bigint:true});
  for(const [name,actual] of [['rootDevice',leases.rootInfo.dev],['rootInode',leases.rootInfo.ino],['lockDevice',held.dev],['lockInode',held.ino]] as const) {
    assert.equal(BigInt(integer(index[name],name.endsWith('Inode')?1:0,Number.MAX_SAFE_INTEGER,name)),actual,'Capture record belongs to another actual root or lease');
  }
  assert.ok(Array.isArray(record.jobs)&&Array.isArray(envelope.captures)&&record.jobs.length===envelope.captures.length&&record.jobs.length<=256,'Complete capture membership differs');
  const captures=envelope.captures as Row[],jobs=record.jobs as Row[];
  const snapshot=object(envelope.snapshotRoot,['path','device','inode'],'Snapshot root'),snapshotPath=canonicalPath(snapshot.path,'Snapshot root');
  assert.equal(snapshotPath,path.join(root,'audit.execution'),'Snapshot must be its owned fixed slot');
  const directory=lstatSync(snapshotPath);assert.ok(directory.isDirectory()&&directory.uid===process.getuid!()&&(directory.mode&0o777)===0o700);assert.equal(directory.dev,snapshot.device);assert.equal(directory.ino,snapshot.inode);
  assert.equal(fileURLToPath(new URL('../../',import.meta.url)),path.join(snapshotPath,'capture.execution')+path.sep,'Worker must execute its owned frozen source');
  const permitted=new Set(['features.sqlite','features.sqlite-wal','capture.execution']);for(const name of readdirSync(snapshotPath))assert.ok(permitted.has(name),'Unknown snapshot state');
  const limits=binding.engineLimits as FeatureIndexLimits,fileLimit=integer((binding.processLimits as Row).fileBytes,65536,64*1024*1024,'File limit');
  const databasePin=pin(envelope.database,Math.min(fileLimit,limits.databaseBytes),'Database'),databasePath=path.join(snapshotPath,'features.sqlite'),databaseBefore=streamPin(databasePath,databasePin);
  if(envelope.wal===null)assert.ok(!readdirSync(snapshotPath).includes('features.sqlite-wal'),'Unexpected snapshot WAL');else streamPin(path.join(snapshotPath,'features.sqlite-wal'),pin(envelope.wal,fileLimit,'WAL',0));
  function* inputs():IterableIterator<AuditCaptureInput>{
    for(let i=0;i<captures.length;i++){
      const item=object(captures[i],['extractPath','receiptPath','expectedBase64','requiredObservations','allowedObservationPins'],'Capture input'),job=jobs[i]!,owned=job.input as Row;
      assert.equal(item.extractPath,owned.extractPath);assert.equal(item.receiptPath,owned.receiptPath);
      const expected=expectedBytes(item.expectedBase64,pin(owned.expected,64000,'Expected capture'));assert.equal(expected.requestHash,job.requestHash);assert.equal(expected.request.provider,source.provider);assert.equal(expected.request.release,source.release);
      assert.ok(Array.isArray(source.layers)&&expected.request.layers.every(layer=>(source.layers as unknown[]).includes(layer)),'Capture layers exceed admitted source layers');
      const {required,allowed}=compareContexts(item.requiredObservations,item.allowedObservationPins,job.attempts as Row[]);
      yield {extractBytes:rawBytes(item.extractPath,expected.extract,20000000,'Extract'),receiptBytes:rawBytes(item.receiptPath,expected.receipt,1000000,'Receipt'),expected,sourceConfiguration:{bytes:sourceBytes,pin:sourcePin},requiredObservations:required,allowedObservationPins:allowed};
    }
  }
  let result:ReturnType<typeof auditFeatureIndexConnection>;const db=new DatabaseSync(databasePath,{readOnly:true});
  try{result=auditFeatureIndexConnection(db,limits,inputs());}finally{db.close();}
  assert.equal(streamPin(databasePath,databasePin),databaseBefore,'Read-only snapshot DB changed');
  assert.equal(sha256(privatePath(path.join(root,'capture.json'),512000,0o600,'Capture record')),recordPin.sha256);assert.equal(sha256(privatePath(path.join(root,'binding.json'),4096,0o600,'Index binding')),envelope.indexHash);validateRootAndLeases(root,leaseFd,namespaceFd);
  const after=lstatSync(snapshotPath);assert.equal(after.dev,directory.dev);assert.equal(after.ino,directory.ino);
  return {format:'feature-index-audit-worker-v1',indexHash:envelope.indexHash,inputSha256:inputSha,captureRecordSha256:recordPin.sha256,nodeVersion:process.version,sqliteVersion:process.versions.sqlite,result,databaseBytes:databasePin.bytes,maximumRssKiB:process.resourceUsage().maxRSS};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(auditFeatureIndexWorker()));
