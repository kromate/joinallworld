import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AcquisitionBudgetError, parseAcquisitionBudgetEnvelope } from './acquisition-errors.ts';
import { acquireRegion } from './acquire.ts';
import type { AcquisitionRequest } from './production-types.ts';

function request():AcquisitionRequest {
  return {
    schemaVersion:1,id:'typed-budget-fixture',inventoryUnitId:'country-gh',provider:'overture',release:'2026-09-23.1',
    region:{id:'typed-budget-fixture',parentId:'accra',name:'Fixture cell',kind:'cell',countryCode:'GH',timezone:'Africa/Accra',bounds:[-0.207,5.552,-0.203,5.556]},
    layers:['buildings'],limits:{networkBytes:2_000_000,outputBytes:2_000_000,features:10_000,durationMs:60_000,memoryMb:1024,diskBytes:64_000_000},
  };
}

test('strict failure envelope accepts only the three explicit measured budget reasons',()=>{
  const reasons=['selected-item-count','feature-row-budget','geojson-output-bytes'] as const;
  for(const reason of reasons){const parsed=parseAcquisitionBudgetEnvelope({schemaVersion:1,kind:'budget-exceeded',reason,networkBytesMeasured:123});assert.equal(parsed?.reason,reason);assert.equal(parsed?.networkBytesMeasured,123);}
  for(const invalid of [
    {schemaVersion:true,kind:'budget-exceeded',reason:reasons[0],networkBytesMeasured:0},
    {schemaVersion:1,kind:'budget-exceeded',reason:'disk-byte-budget',networkBytesMeasured:0},
    {schemaVersion:1,kind:'budget-exceeded',reason:reasons[0],networkBytesMeasured:-1},
    {schemaVersion:1,kind:'budget-exceeded',reason:reasons[0],networkBytesMeasured:1.5},
    {schemaVersion:1,kind:'budget-exceeded',reason:reasons[0],networkBytesMeasured:0,detail:'inferred'},
  ])assert.equal(parseAcquisitionBudgetEnvelope(invalid),null);
  const error=new AcquisitionBudgetError('feature-row-budget',123);
  assert.equal(error.name,'AcquisitionBudgetError');assert.equal(error.reason,'feature-row-budget');assert.equal(error.networkBytesMeasured,123);
  const unsafeConstruct = AcquisitionBudgetError as unknown as new(reason: unknown, measured: unknown) => AcquisitionBudgetError;
  for (const [reason, measured] of [['not-a-reason', 0], ['feature-row-budget', -1], ['feature-row-budget', Number.NaN], ['feature-row-budget', 1.5]] as const) {
    assert.throws(() => new unsafeConstruct(reason, measured), /invalid acquisition budget failure evidence/);
  }
});

async function invokeStub(envelope:Record<string,unknown>,exitCode=3,runs=1):Promise<{error:unknown;events:Record<string,unknown>[]}> {
  const parent=await mkdtemp(path.join(await realpath(os.tmpdir()),'typed-acquisition-error-'));
  try {
    const python=path.join(parent,'python3.12'),allowedRoot=path.join(parent,'build');
    await writeFile(python,`#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(envelope)}'\nexit ${exitCode}\n`);await chmod(python,0o755);
    let caught:unknown;
    for(let run=0;run<runs;run++)try{await acquireRegion(request(),{allowedRoot,pythonExecutable:python});}catch(error){caught=error;}
    const attemptRoot=path.join(allowedRoot,'acquisition-attempts');
    const names=await readdir(attemptRoot);
    assert.equal(names.length,1);
    const events=(await readFile(path.join(attemptRoot,names[0]!,'attempts.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as Record<string,unknown>);
    return {error:caught,events};
  } finally {await rm(parent,{recursive:true,force:true});}
}

test('normal adapter exit 3 persists typed failureKind and authoritative measured bytes',async()=>{
  const envelope={schemaVersion:1,kind:'budget-exceeded',reason:'feature-row-budget',networkBytesMeasured:321};
  const {error,events}=await invokeStub(envelope,3,2);
  assert.ok(error instanceof AcquisitionBudgetError);assert.equal(error.reason,'feature-row-budget');assert.equal(error.networkBytesMeasured,321);assert.match(error.message,/failure evidence/);
  assert.equal(events[0]?.status,'pending');assert.equal(events[1]?.failureKind,'feature-row-budget');assert.equal(events[1]?.networkBytesMeasured,321);assert.equal(events[1]?.networkReservationUpperBoundBytes,2_000_000);
  assert.equal(events[2]?.attempt,2);assert.equal(events[3]?.failureKind,'feature-row-budget');assert.equal(events[3]?.networkBytesMeasured,321,'future appends revalidate the typed audit record');
});

test('malformed typed failure or non-typed process exit keeps opaque full reservation',async()=>{
  const {error,events}=await invokeStub({schemaVersion:1,kind:'budget-exceeded',reason:'feature-row-budget',networkBytesMeasured:321,extra:true});
  assert.ok(error instanceof Error);assert.equal(error instanceof AcquisitionBudgetError,false);assert.match(error.message,/invalid typed failure/);
  assert.equal(events[1]?.failureKind,undefined);assert.equal(events[1]?.networkBytesMeasured,null);assert.equal(events[1]?.networkReservationUpperBoundBytes,2_000_000);
});

test('typed measurement above the caller network cap is treated as opaque',async()=>{
  const {error,events}=await invokeStub({schemaVersion:1,kind:'budget-exceeded',reason:'geojson-output-bytes',networkBytesMeasured:2_000_001});
  assert.equal(error instanceof AcquisitionBudgetError,false);assert.equal(events[1]?.failureKind,undefined);assert.equal(events[1]?.networkBytesMeasured,null);
});
