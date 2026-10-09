import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ALLOWED_ROOT } from './pipeline.ts';
import { parseCaptureJson } from './capture-json.ts';
import { canonicalJson, sha256 } from './pack.ts';
import { featureIndexObservationPin, type FeatureIndexObservation } from './feature-index.ts';
import type { FeatureIndexSessionConfiguration, FeatureIndexCaptureInput } from './feature-index-session.ts';
import type { GridQueryCampaign, GridQueryUnit } from './grid-query-types.ts';
import type { EnqueueInput } from './ledger.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';

export interface CampaignIndexBinding {
  format: 'campaign-feature-index-binding-v1';
  campaignHash: string; inventoryHash: string; planHash: string; indexHash: string;
  configuration: {
    namespaceRoot: string; aggregateBytes: number; repositoryRoot: string;
    pythonExecutable: string; nodeExecutable: string;
    pythonRuntime: FeatureIndexSessionConfiguration['pythonRuntime'];
    manifest: { sha256: string; bytes: number };
    sourceConfiguration: { sha256: string; bytes: number };
    binding: { sha256: string; bytes: number };
  };
}
export interface CampaignIndexCoverage {
  scope: 'recorded-source-feature-index'; geometryCoverage: 'not-compiled';
  integrity: 'independent-raw-index-audit-required'; enabled: boolean;
  jobLimit: 256; capacityBlocked: boolean;
  captured: number; indexed: number; pending: number; leased: number; failed: number; untracked: number;
}
const fields = (value: unknown, expected: string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== expected.length) throw new Error(`${label} has invalid fields`);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(`${label} requires exact data fields`);
  }
  return value as Record<string, unknown>;
};
const pin = (bytes: Uint8Array) => ({ sha256: sha256(bytes), bytes: bytes.byteLength });
const inside = (parent: string, child: string) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };

/** Freeze caller buffers before the first await; no allocation, worker or admission. */
export function freezeCampaignIndexConfiguration(value: FeatureIndexSessionConfiguration): FeatureIndexSessionConfiguration {
  const raw = fields(value, ['namespaceRoot','aggregateBytes','repositoryRoot','pythonExecutable','nodeExecutable','pythonRuntime','manifestBytes','sourceConfiguration','bindingBytes'], 'campaign index configuration');
  const runtime = fields(raw.pythonRuntime, ['pythonVersion','sqliteVersion','pythonBytes','pythonSha256'], 'Python pin');
  const copy = (name: string, max: number) => {
    const bytes = raw[name];
    if (!(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer || !bytes.byteLength || bytes.byteLength > max) throw new Error(`invalid ${name} bytes`);
    return Buffer.from(bytes);
  };
  for (const key of ['namespaceRoot','repositoryRoot','pythonExecutable','nodeExecutable']) {
    const name = raw[key];
    if (typeof name !== 'string' || !path.isAbsolute(name) || path.resolve(name) !== name || /[\u0000-\u001f\u007f-\uffff\\]/.test(name) || name.length > 4096) throw new Error(`invalid canonical ${key}`);
  }
  if (!Number.isSafeInteger(raw.aggregateBytes) || (raw.aggregateBytes as number) < 17 * 1024 * 1024 + 65536 || (raw.aggregateBytes as number) > 512 * 1024 * 1024) throw new Error('invalid namespace aggregate budget');
  if (typeof runtime.pythonVersion !== 'string' || !/^\d{1,3}(\.\d{1,3}){2}$/.test(runtime.pythonVersion)
      || typeof runtime.sqliteVersion !== 'string' || !/^\d{1,3}(\.\d{1,3}){2}$/.test(runtime.sqliteVersion)
      || !Number.isSafeInteger(runtime.pythonBytes) || (runtime.pythonBytes as number) < 1 || (runtime.pythonBytes as number) > 256 * 1024 * 1024
      || typeof runtime.pythonSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(runtime.pythonSha256)) throw new Error('invalid Python runtime pin');
  return { namespaceRoot: raw.namespaceRoot as string, repositoryRoot: raw.repositoryRoot as string,
    aggregateBytes: raw.aggregateBytes as number, pythonExecutable: raw.pythonExecutable as string, nodeExecutable: raw.nodeExecutable as string,
    pythonRuntime: { pythonVersion:runtime.pythonVersion as string,sqliteVersion:runtime.sqliteVersion as string,pythonBytes:runtime.pythonBytes as number,pythonSha256:runtime.pythonSha256 },
    manifestBytes: copy('manifestBytes',64000), sourceConfiguration: copy('sourceConfiguration',64000), bindingBytes: copy('bindingBytes',4096) };
}

export async function readCampaignIndexBinding(dir: string, campaign: GridQueryCampaign, hash: string): Promise<CampaignIndexBinding | null> {
  const filename = path.join(dir,'feature-index-binding.json');
  let bytes: Uint8Array;
  try { bytes = await readBoundedLocalFile(filename,16000); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  const raw = fields(parseCaptureJson(bytes,{bytes:16000}), ['format','campaignHash','inventoryHash','planHash','indexHash','configuration'], 'campaign index binding');
  if (raw.format !== 'campaign-feature-index-binding-v1' || raw.campaignHash !== hash || raw.inventoryHash !== campaign.inventoryHash || raw.planHash !== campaign.gridQuery.planHash || typeof raw.indexHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.indexHash)) throw new Error('stored campaign index binding differs from the frozen campaign');
  const config = fields(raw.configuration,['namespaceRoot','aggregateBytes','repositoryRoot','pythonExecutable','nodeExecutable','pythonRuntime','manifest','sourceConfiguration','binding'],'stored index configuration');
  for (const key of ['manifest','sourceConfiguration','binding']) {
    const item = fields(config[key],['sha256','bytes'],`${key} pin`);
    if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.bytes) || (item.bytes as number) < 1 || (item.bytes as number) > (key === 'binding' ? 4096 : 64000)) throw new Error('stored campaign index pin is invalid');
  }
  if ((config.binding as {sha256:string}).sha256 !== raw.indexHash) throw new Error('stored index identity differs from its binding pin');
  // Validate the runtime/path/budget shape with tiny private buffers. Actual pins are
  // retained above; a status read never opens a session or verifies SQL indirectly.
  freezeCampaignIndexConfiguration({ namespaceRoot:config.namespaceRoot,aggregateBytes:config.aggregateBytes,repositoryRoot:config.repositoryRoot,
    pythonExecutable:config.pythonExecutable,nodeExecutable:config.nodeExecutable,pythonRuntime:config.pythonRuntime,
    manifestBytes:Buffer.from('x'),sourceConfiguration:Buffer.from('x'),bindingBytes:Buffer.from('x') } as FeatureIndexSessionConfiguration);
  return raw as unknown as CampaignIndexBinding;
}

export async function bindCampaignIndex(dir: string, campaign: GridQueryCampaign, hash: string,
                                        config: FeatureIndexSessionConfiguration | undefined): Promise<CampaignIndexBinding | null> {
  const previous = await readCampaignIndexBinding(dir,campaign,hash);
  if (!config) return previous;
  if(campaign.limits.maxAttempts>8)throw new Error('feature index shard supports at most eight charged attempts; the original campaign retry limit must fit before indexing is enabled');
  const ns = config.namespaceRoot, production = path.join(ALLOWED_ROOT,'feature-index'), temp = await realpath(tmpdir());
  if (!inside(production,ns) && !inside(temp,ns)) throw new Error('feature index namespace must be inside its separate builder root or private temporary state');
  const info = await lstat(ns);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(ns) !== ns || (info.mode & 0o777) !== 0o700 || info.uid !== process.getuid?.()) throw new Error('feature index namespace must be an existing canonical owned private 0700 directory');
  const binding = parseCaptureJson(config.bindingBytes,{bytes:4096}) as {source?:{configuration?:unknown;release?:unknown;layers?:unknown};toolingManifest?:unknown};
  if (canonicalJson(binding) !== new TextDecoder('utf-8',{fatal:true}).decode(config.bindingBytes)
      || canonicalJson(binding.toolingManifest) !== canonicalJson(pin(config.manifestBytes))
      || canonicalJson(binding.source?.configuration) !== canonicalJson(pin(config.sourceConfiguration))
      || campaign.units.some(unit => unit.request.release !== binding.source?.release || canonicalJson(unit.request.layers) !== canonicalJson(binding.source?.layers))) throw new Error('campaign index binding does not pin its exact source/manifest/release/layers');
  const currentSource = await readFile(new URL('./acquisition-sources.json',import.meta.url));
  if (sha256(currentSource) !== sha256(config.sourceConfiguration)) throw new Error('campaign acquisition and indexing source configurations differ');
  const candidate: CampaignIndexBinding = { format:'campaign-feature-index-binding-v1',campaignHash:hash,inventoryHash:campaign.inventoryHash,planHash:campaign.gridQuery.planHash,indexHash:sha256(config.bindingBytes),
    configuration:{namespaceRoot:ns,aggregateBytes:config.aggregateBytes,repositoryRoot:config.repositoryRoot,pythonExecutable:config.pythonExecutable,nodeExecutable:config.nodeExecutable,
      pythonRuntime:{...config.pythonRuntime},manifest:pin(config.manifestBytes),sourceConfiguration:pin(config.sourceConfiguration),binding:pin(config.bindingBytes)} };
  if (previous && canonicalJson(previous) !== canonicalJson(candidate)) throw new Error('campaign feature index configuration is immutable');
  if (!previous) await writeFile(path.join(dir,'feature-index-binding.json'),canonicalJson(candidate),{flag:'wx',mode:0o600});
  return candidate;
}

export function campaignIndexInput(campaign: GridQueryCampaign, hash: string, unit: GridQueryUnit, sourceJob: Record<string,unknown>): FeatureIndexCaptureInput {
  const captured = sourceJob.result as {plan:{input:{path:string}};receiptPath:string;requestHash:string;inputSha256:string;inputBytes:number;receiptSha256:string;receiptBytes:number};
  const observation: FeatureIndexObservation = {campaignHash:hash,planHash:campaign.gridQuery.planHash,jobId:String(sourceJob.id),rootCellId:unit.query.rootCellId,queryPath:unit.query.path};
  featureIndexObservationPin(observation);
  return {extractPath:captured.plan.input.path,receiptPath:captured.receiptPath,
    expected:{requestHash:captured.requestHash,request:unit.request,extract:{sha256:captured.inputSha256,bytes:captured.inputBytes},receipt:{sha256:captured.receiptSha256,bytes:captured.receiptBytes}},observation};
}
export function campaignIndexJob(campaign: GridQueryCampaign, binding: CampaignIndexBinding, unit: GridQueryUnit,
                                  sourceJob: Record<string,unknown>, input: FeatureIndexCaptureInput): EnqueueInput {
  const payload = {campaignId:campaign.id,campaignHash:binding.campaignHash,inventoryHash:campaign.inventoryHash,planHash:binding.planHash,indexHash:binding.indexHash,
    configurationHash:sha256(canonicalJson(binding)),sourceJobId:sourceJob.id,input};
  return {id:`${campaign.id}:feature-index:${sourceJob.id}`,kind:'campaign-index-capture',inputHash:sha256(canonicalJson(payload)),payload,maxAttempts:campaign.limits.maxAttempts,priority:unit.priority};
}
export function campaignIndexCompletion(report: Record<string,unknown>, indexHash: string): Record<string,unknown> {
  const worker = report.ingest as {result:Record<string,unknown>};
  const charges = report.captureController as {attempts:number;recordSha256:string};
  const result = worker.result;
  return {status:'capture-indexed',indexHash,observationHash:result.observationHash,requestHash:result.requestHash,captureHash:result.captureHash,
    features:result.features,admitted:result.admitted,exceptions:result.exceptions,dispositionsHash:result.dispositionsHash,attempts:charges.attempts,recordSha256:charges.recordSha256};
}
/** Presence/pin checks only. This explicitly does not stand in for the raw/SQL audit. */
export async function verifyCampaignIndexFiles(binding: CampaignIndexBinding): Promise<void> {
  const ns=binding.configuration.namespaceRoot, root=path.join(ns,binding.indexHash);
  for (const directory of [ns,root]) {
    const info=await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory)!==directory || info.uid!==process.getuid?.() || (info.mode & 0o777)!==0o700) throw new Error('recorded feature index directory is missing or unsafe');
  }
  const bytes=await readBoundedLocalFile(path.join(root,'binding.json'),4096);
  if (sha256(bytes)!==binding.indexHash || bytes.byteLength!==binding.configuration.binding.bytes) throw new Error('recorded feature index binding is missing or corrupt');
  const file=path.join(root,'features.sqlite'),info=await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(file)!==file || info.uid!==process.getuid?.() || info.nlink!==1 || info.size<4096 || info.size>64*1024*1024 || info.size%4096!==0) throw new Error('recorded feature index database is missing or outside its bounds');
}
export function verifyCampaignIndexCompletion(value: unknown, input: FeatureIndexCaptureInput, indexHash: string, sourceFeatures: unknown): void {
  const result = fields(value,['status','indexHash','observationHash','requestHash','captureHash','features','admitted','exceptions','dispositionsHash','attempts','recordSha256'],'recorded index completion');
  if (result.status !== 'capture-indexed' || result.indexHash !== indexHash || result.requestHash !== input.expected.requestHash || result.observationHash !== featureIndexObservationPin(input.observation!).sha256 || result.features !== sourceFeatures) throw new Error('recorded index completion differs from its frozen source observation');
  if(result.captureHash!==sha256(canonicalJson({version:'overture-pinned-capture-v1',requestHash:input.expected.requestHash,extract:input.expected.extract,receipt:input.expected.receipt})))throw new Error('recorded index capture hash differs from its retained byte pins');
  for (const key of ['captureHash','dispositionsHash','recordSha256']) if (typeof result[key] !== 'string' || !/^[a-f0-9]{64}$/.test(result[key] as string)) throw new Error('invalid recorded index hash');
  for (const key of ['features','admitted','attempts']) if (!Number.isSafeInteger(result[key]) || (result[key] as number) < (key === 'attempts' ? 1 : 0) || (key === 'attempts' && (result[key] as number) > 8)) throw new Error('invalid recorded index count');
  const exceptions = result.exceptions;
  if (!exceptions || typeof exceptions !== 'object' || Array.isArray(exceptions)) throw new Error('invalid recorded dispositions');
  let excluded = 0;
  for (const [name,count] of Object.entries(exceptions)) { if (!name.trim() || name.length > 128 || !Number.isSafeInteger(count) || count < 1) throw new Error('invalid recorded disposition count'); excluded += count; }
  if ((result.admitted as number) + excluded !== result.features) throw new Error('recorded index dispositions do not conserve source features');
}
