import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { campaignStatus, runCampaign } from './campaign.ts';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function usage():never{console.error('Usage:\n  node --experimental-strip-types world/campaign-cli.ts run <campaign.json> [--inventory-manifest /path/to/manifests/<sha>.json] [--country-grid-plan /path/to/plans/<sha>.json] [--max-jobs N] [--python /absolute/path/python3]\n  node --experimental-strip-types world/campaign-cli.ts resume <campaign.json> [--inventory-manifest /path/to/manifests/<sha>.json] [--country-grid-plan /path/to/plans/<sha>.json] [--max-jobs N] [--python /absolute/path/python3]\n  node --experimental-strip-types world/campaign-cli.ts status <campaign-id>');process.exit(2);}
function options(args:string[]):{maxJobs?:number;pythonExecutable?:string;inventoryManifestPath?:string;countryGridPlanPath?:string}{const out:{maxJobs?:number;pythonExecutable?:string;inventoryManifestPath?:string;countryGridPlanPath?:string}={};for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!value||value.startsWith('--'))usage();if(flag==='--max-jobs'&&!out.maxJobs){const n=Number(value);if(!Number.isSafeInteger(n)||n<1)usage();out.maxJobs=n;}else if(flag==='--python'&&!out.pythonExecutable&&path.isAbsolute(value))out.pythonExecutable=value;else if(flag==='--country-grid-plan'&&!out.countryGridPlanPath&&path.isAbsolute(value))out.countryGridPlanPath=value;else if(flag==='--inventory-manifest'&&!out.inventoryManifestPath&&path.isAbsolute(value))out.inventoryManifestPath=value;else usage();}return out;}
try{
  const[command,target,...flags]=process.argv.slice(2);
  if(command==='status'&&target&&flags.length===0){const report=await campaignStatus(target);console.log(JSON.stringify(report,null,2));if(report.status==='exception')process.exitCode=1;else if(report.status==='running'||report.status==='stopped')process.exitCode=2;}
  else if((command==='run'||command==='resume')&&target){const file=path.resolve(root,target);const input=JSON.parse(await readFile(file,'utf8')) as unknown,controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);let result;try{result=await runCampaign(input,{...options(flags),signal:controller.signal});}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}console.log(JSON.stringify(result,null,2));if(result.status==='exception')process.exitCode=1;else if(result.status==='stopped')process.exitCode=2;}
  else usage();
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
