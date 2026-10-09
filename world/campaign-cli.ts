import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { campaignStatus, runCampaign } from './campaign.ts';
import type { CampaignOptions } from './campaign.ts';
import { parseCaptureJson } from './capture-json.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import type { FeatureIndexSessionConfiguration } from './feature-index-session.ts';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function usage():never{console.error('Usage:\n  node --experimental-strip-types world/campaign-cli.ts run|resume <campaign.json> [--inventory-manifest /absolute/manifests/<sha>.json] [--country-grid-plan /absolute/plans/<sha>.json] [--max-jobs N] [--max-index-jobs 0..256] [--max-audit-jobs 0|1] [--feature-index-config /absolute/config.json] [--python /absolute/python3]\n  node --experimental-strip-types world/campaign-cli.ts status <campaign-id>');process.exit(2);}
async function options(args:string[]):Promise<CampaignOptions>{
  const out:CampaignOptions={},seen=new Set<string>();
  for(let i=0;i<args.length;i+=2){
    const flag=args[i]!,value=args[i+1];if(!value||value.startsWith('--')||seen.has(flag))usage();seen.add(flag);
    if(flag==='--max-jobs'||flag==='--max-index-jobs'){
      const n=Number(value);if(!/^(0|[1-9][0-9]*)$/.test(value)||!Number.isSafeInteger(n)||n<0||(flag==='--max-index-jobs'&&n>256))usage();
      if(flag==='--max-jobs')out.maxJobs=n;else out.maxIndexJobs=n;
    }else if(flag==='--max-audit-jobs'&&(value==='0'||value==='1'))out.maxAuditJobs=Number(value) as 0|1;
    else if(flag==='--python'&&path.isAbsolute(value))out.pythonExecutable=value;
    else if(flag==='--country-grid-plan'&&path.isAbsolute(value))out.countryGridPlanPath=value;
    else if(flag==='--inventory-manifest'&&path.isAbsolute(value))out.inventoryManifestPath=value;
    else if(flag==='--feature-index-config'&&path.isAbsolute(value))out.featureIndex=await readIndexConfiguration(value);
    else usage();
  }
  return out;
}
async function readIndexConfiguration(filename:string):Promise<FeatureIndexSessionConfiguration>{
  const raw=parseCaptureJson(await readBoundedLocalFile(filename,16000),{bytes:16000}) as Record<string,unknown>;
  const expected=['format','pythonExecutable','pythonRuntime','nodeExecutable','namespaceRoot','aggregateBytes','repositoryRoot','manifestPath','sourceConfigurationPath','bindingPath'];
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==expected.length||expected.some(key=>!Object.hasOwn(raw,key))||raw.format!=='campaign-feature-index-configuration-v1')throw new Error('feature index CLI configuration requires exact fields and version');
  const load=async(key:string,max:number)=>{const file=raw[key];if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)throw new Error(`${key} must be a canonical absolute file`);return readBoundedLocalFile(file,max);};
  return {pythonExecutable:raw.pythonExecutable,nodeExecutable:raw.nodeExecutable,pythonRuntime:raw.pythonRuntime,namespaceRoot:raw.namespaceRoot,aggregateBytes:raw.aggregateBytes,repositoryRoot:raw.repositoryRoot,
    manifestBytes:await load('manifestPath',64000),sourceConfiguration:await load('sourceConfigurationPath',64000),bindingBytes:await load('bindingPath',4096)} as FeatureIndexSessionConfiguration;
}
try{
  const[command,target,...flags]=process.argv.slice(2);
  if(command==='status'&&target&&flags.length===0){const report=await campaignStatus(target);console.log(JSON.stringify(report,null,2));if(report.status==='exception')process.exitCode=1;else if(report.status==='running'||report.status==='stopped')process.exitCode=2;}
  else if((command==='run'||command==='resume')&&target){const file=path.resolve(root,target);const input=JSON.parse(await readFile(file,'utf8')) as unknown,controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);let result;try{result=await runCampaign(input,{...await options(flags),signal:controller.signal});}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}console.log(JSON.stringify(result,null,2));if(result.status==='exception')process.exitCode=1;else if(result.status==='stopped')process.exitCode=2;}
  else usage();
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
