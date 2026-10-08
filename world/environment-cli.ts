import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnvironmentManifest, ENVIRONMENT_LIMITS, fetchPilotBatch, fetchPowerMonthly, loadCachedRaw, publishEnvironment, validateEnvironmentRequest } from './environment.ts';
import type { EnvironmentRequest } from './environment-types.ts';

const repo=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const allowedRoot=path.join(repo,'.cache','world-build');
const outputRoot=path.join(allowedRoot,'output','environment');
interface PilotPin {request:EnvironmentRequest;url:string;cacheFile:string;bytes:number;sha256:string;}
async function catalog():Promise<{pilots:PilotPin[]}>{const raw=await readFile(path.join(repo,'world','environment-sources.json'));const value=JSON.parse(raw.toString('utf8')) as {pilots?:unknown};if(!Array.isArray(value.pilots))throw new TypeError('environment-sources.json has no pilot list');return {pilots:value.pilots as PilotPin[]};}
function usage():never{console.error('Usage:\n  node --experimental-strip-types world/environment-cli.ts build <pilot-id>\n  node --experimental-strip-types world/environment-cli.ts build-all\n  node --experimental-strip-types world/environment-cli.ts fetch <pilot-id>\n  node --experimental-strip-types world/environment-cli.ts fetch-all');process.exit(2);}
function getPilot(pilots:PilotPin[],id:string){const pilot=pilots.find(x=>x.request.id===id);if(!pilot)throw new Error(`unknown pinned environment pilot: ${id}`);validateEnvironmentRequest(pilot.request);if(!/^[a-f0-9]{64}$/.test(pilot.sha256)||!Number.isSafeInteger(pilot.bytes)||pilot.bytes<1||!pilot.url.startsWith('https://power.larc.nasa.gov/api/temporal/monthly/point?'))throw new Error(`pilot pin is invalid: ${id}`);return pilot;}
async function build(pilot:PilotPin){const input=path.resolve(repo,pilot.cacheFile),relative=path.relative(allowedRoot,input);if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('cached POWER input is outside .cache/world-build');const bytes=await loadCachedRaw(input,pilot.sha256,pilot.bytes,allowedRoot);const manifest=buildEnvironmentManifest(pilot.request,bytes,pilot.url);const published=await publishEnvironment(manifest,bytes,outputRoot,allowedRoot);return {id:pilot.request.id,region:pilot.request.name,sourceBytes:bytes.byteLength,sourceHash:pilot.sha256,manifestPath:published.manifestPath,manifestHash:published.manifestHash,months:manifest.profile.months};}
async function fetch(pilot:PilotPin){const result=await fetchPowerMonthly(pilot.request,{allowedRoot});const published=await publishEnvironment(result.manifest,result.rawBytes,outputRoot,allowedRoot);return {id:pilot.request.id,region:pilot.request.name,url:result.receipt.url,sourceBytes:result.receipt.bytes,sourceHash:result.receipt.sha256,sourceCachePath:result.receipt.sourceCachePath,manifestPath:published.manifestPath,manifestHash:published.manifestHash};}
try{const [command,id,...extra]=process.argv.slice(2);if(extra.length)usage();const {pilots}=await catalog();
 if(command==='build'&&id)console.log(JSON.stringify(await build(getPilot(pilots,id)),null,2));
 else if(command==='build-all'&&!id){const results=[];for(const pilot of pilots)results.push(await build(pilot));console.log(JSON.stringify({count:results.length,results},null,2));}
 else if(command==='fetch'&&id)console.log(JSON.stringify(await fetch(getPilot(pilots,id)),null,2));
 else if(command==='fetch-all'&&!id){if(pilots.length>ENVIRONMENT_LIMITS.maxPilots)throw new Error('catalog exceeds bounded six-pilot batch');const result=await fetchPilotBatch(pilots.map(p=>p.request),{allowedRoot,outputRoot});console.log(JSON.stringify(result,null,2));}
 else usage();
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
