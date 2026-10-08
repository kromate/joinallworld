import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildInventory } from './inventory.ts';
import { buildFineCatalogue, FINE_CATALOGUE_URL } from './fine-catalogue.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { readCoarseInventoryCountry } from './inventory-reader.ts';
import { validateInventoryManifest } from './preview/inventory-view.ts';

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
};
function firstDifference(expected: unknown, actual: unknown, at = '$'): string | null {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return at;
    if (expected.length !== actual.length) return `${at}.length`;
    for (let i=0;i<expected.length;i++) { const mismatch=firstDifference(expected[i],actual[i],`${at}[${i}]`);if(mismatch)return mismatch; }
    return null;
  }
  if (expected && actual && typeof expected==='object' && typeof actual==='object') {
    const e=expected as Record<string,unknown>,a=actual as Record<string,unknown>,keys=[...new Set([...Object.keys(e),...Object.keys(a)])].sort();
    for(const key of keys){if(!(key in e)||!(key in a))return `${at}.${key}`;const mismatch=firstDifference(e[key],a[key],`${at}.${key}`);if(mismatch)return mismatch;}
    return null;
  }
  return Object.is(expected,actual) ? null : at;
}
function cachePath(root: string, relative: string): string {
  if (!relative.startsWith('.cache/world-build/')) throw new TypeError('pinned input path must stay under .cache/world-build');
  const resolved=path.resolve(root,relative),base=path.resolve(root,'.cache/world-build'),rel=path.relative(base,resolved);
  if (!rel || rel==='..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new TypeError('pinned input escapes the build cache');
  return resolved;
}
function parseInventoryHash(args: string[]): string {
  if(args.length!==2||args[0]!=='--inventory-hash'||!/^[a-f0-9]{64}$/.test(args[1]??'')) throw new TypeError('usage: node --experimental-strip-types world/fine-catalogue-cli.ts --inventory-hash <64-hex-manifest-sha256>');
  return args[1]!;
}

/** Rebuilds the checked-in discovery report exclusively from already-pinned local bytes. */
export async function verifyFineCatalogueCache(args: string[]): Promise<Record<string,unknown>> {
  const inventoryHash=parseInventoryHash(args);
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const cacheRoot=path.join(root,'.cache','world-build');
  const readJson=async(filename:string,max:number):Promise<unknown>=>JSON.parse((await readBoundedLocalFile(filename,max)).toString('utf8')) as unknown;

  const frozen=await readJson(path.join(root,'world','fine-catalogue-sources.json'),1_000_000) as Record<string,unknown>;
  if(!frozen||frozen.schemaVersion!==1||frozen.purpose!=='metadata-discovery-only'||!frozen.pin||typeof frozen.pin!=='object') throw new TypeError('frozen fine catalogue report is invalid');
  const capturePolicy=frozen.capturePolicy;
  if(!capturePolicy||typeof capturePolicy!=='object'||(capturePolicy as Record<string,unknown>).coarseInventoryHash!==inventoryHash) throw new Error('requested coarse inventory hash does not match the frozen catalogue binding');
  const pin=frozen.pin as {sourceUrl?:unknown;sha256?:unknown;bytes?:unknown;capturedAt?:unknown};
  if(pin.sourceUrl!==FINE_CATALOGUE_URL||typeof pin.sha256!=='string'||!/^[a-f0-9]{64}$/.test(pin.sha256)||!Number.isSafeInteger(pin.bytes)||typeof pin.capturedAt!=='string') throw new TypeError('frozen metadata pin is invalid');
  const metadataPath=cachePath(root,`.cache/world-build/fine-catalogue-cache/all-adm1-metadata.${pin.sha256}.json`);
  const metadataBytes=await readBoundedLocalFile(metadataPath,2*1024*1024);
  if(metadataBytes.byteLength!==pin.bytes||hash(metadataBytes)!==pin.sha256) throw new Error('cached metadata bytes do not match frozen SHA-256/byte pin');

  const coarseConfig=await readJson(path.join(root,'world','inventory-sources.json'),64*1024) as Record<string,unknown>;
  const source=coarseConfig.source;
  const input=coarseConfig.input;
  if(!source||typeof source!=='object'||typeof input!=='string'||!Number.isSafeInteger(coarseConfig.sourceFeatureCount)) throw new TypeError('Natural Earth coarse source pin is invalid');
  const sourcePin=source as {id?:unknown;url?:unknown;release?:unknown;license?:unknown;attribution?:unknown;sha256?:unknown;bytes?:unknown};
  if(typeof sourcePin.id!=='string'||typeof sourcePin.sha256!=='string'||!/^[a-f0-9]{64}$/.test(sourcePin.sha256)||!Number.isSafeInteger(sourcePin.bytes)) throw new TypeError('Natural Earth source byte/hash pin is invalid');
  const naturalEarthPath=cachePath(root,input);
  const naturalEarthBytes=await readBoundedLocalFile(naturalEarthPath,16*1024*1024);
  if(naturalEarthBytes.byteLength!==sourcePin.bytes||hash(naturalEarthBytes)!==sourcePin.sha256) throw new Error('cached Natural Earth bytes do not match source SHA-256/byte pin');
  const geojson=JSON.parse(naturalEarthBytes.toString('utf8')) as unknown;
  const coarse=buildInventory(sourcePin as Parameters<typeof buildInventory>[0],geojson);
  if(coarse.sourceUnitCount!==coarseConfig.sourceFeatureCount) throw new Error('rebuilt coarse source feature count differs from its frozen source pin');

  const inventoryRoot=path.join(cacheRoot,'output','inventory');
  const manifestPath=path.join(inventoryRoot,'manifests',`${inventoryHash}.json`);
  const manifestBytes=await readBoundedLocalFile(manifestPath,1_000_000);
  if(hash(manifestBytes)!==inventoryHash) throw new Error('published coarse inventory manifest hash mismatch');
  const manifest=validateInventoryManifest(JSON.parse(manifestBytes.toString('utf8')) as unknown);
  if(stable(manifest.sources)!==stable(coarse.sources)||manifest.sourceUnitCount!==coarse.sourceUnitCount) throw new Error('published coarse inventory provenance or source denominator differs from rebuilt Natural Earth inventory');
  const rwanda=await readCoarseInventoryCountry(inventoryRoot,inventoryHash,'RW');
  const rebuiltRwanda=coarse.nodes.find(node=>node.kind==='country'&&node.countryCode==='RW');
  if(!rebuiltRwanda||rwanda.id!==rebuiltRwanda.id||stable(rwanda.sourceFeatureIds)!==stable(rebuiltRwanda.sourceFeatureIds)) throw new Error('published coarse hierarchy Rwanda identity differs from rebuilt inventory');

  const actual=buildFineCatalogue(metadataBytes,{sourceUrl:String(pin.sourceUrl),sha256:String(pin.sha256),bytes:Number(pin.bytes),capturedAt:String(pin.capturedAt)},coarse,geojson);
  const {capturePolicy:_capturePolicy,...frozenReport}=frozen;
  const mismatch=firstDifference(frozenReport,actual);
  if(mismatch) throw new Error(`frozen catalogue differs from rebuilt report at ${mismatch}`);
  return {status:'verified',inventoryHash,metadataSha256:pin.sha256,metadataBytes:metadataBytes.byteLength,coarseSourceSha256:sourcePin.sha256,coarseSourceBytes:naturalEarthBytes.byteLength,counts:actual.counts,sourceCounts:actual.sourceCounts};
}

async function main():Promise<void>{
  try{const result=await verifyFineCatalogueCache(process.argv.slice(2));process.stdout.write(`${JSON.stringify(result,null,2)}\n`);}
  catch(error){process.stderr.write(`fine catalogue cache verification failed: ${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) await main();
