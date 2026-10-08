import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInventory, publishInventory } from './inventory.ts';
import type { SourceRecord } from './types.ts';

const repo=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const allowedRoot=path.join(repo,'.cache','world-build');
function usage():never { console.error('Usage: node --experimental-strip-types world/inventory-cli.ts build <pinned.geojson> <source-record.json>'); process.exit(2); }
try {
  const [command,geoPath,sourcePath,...extra]=process.argv.slice(2);
  if(command!=='build'||!geoPath||!sourcePath||extra.length)usage();
  const inputPath=path.resolve(repo,geoPath),recordPath=path.resolve(repo,sourcePath);
  const [inputInfo,recordInfo]=await Promise.all([stat(inputPath),stat(recordPath)]);
  if(!inputInfo.isFile()||inputInfo.size>20_000_000||!recordInfo.isFile()||recordInfo.size>64_000)throw new Error('inventory input or source record exceeds file budget');
  const [inputBytes,recordBytes]=await Promise.all([readFile(inputPath),readFile(recordPath)]);
  if(!inputInfo.isFile()||inputBytes.byteLength!==inputInfo.size)throw new Error('GeoJSON must be a stable regular file');
  const source=JSON.parse(recordBytes.toString('utf8')) as SourceRecord;
  const hash=createHash('sha256').update(inputBytes).digest('hex');
  if(source.bytes!==inputBytes.byteLength||source.sha256!==hash)throw new Error('SourceRecord must match the exact input GeoJSON bytes and SHA-256');
  const geojson=JSON.parse(inputBytes.toString('utf8')) as unknown;
  const inventory=buildInventory(source,geojson);
  const published=await publishInventory(inventory,path.join(allowedRoot,'output','inventory'),allowedRoot);
  console.log(JSON.stringify({source:source.id,sourceUnits:inventory.sourceUnitCount,nodes:inventory.nodes.length,exceptions:inventory.exceptions.length,...published},null,2));
} catch(error) { console.error(error instanceof Error?error.message:String(error)); process.exitCode=1; }
