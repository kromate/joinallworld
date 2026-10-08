import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runAdmin1Topology, topologyExitCode } from './admin1-topology.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function main(): Promise<void> {
  const args=process.argv.slice(2);let manifestHash:string|undefined,durationMs:number|undefined;
  for(let i=0;i<args.length;i++){
    const key=args[i],value=args[i+1];
    if(!value||value.startsWith('--'))throw new TypeError(`missing value for ${key}`);
    if(key==='--manifest-hash'&&manifestHash===undefined)manifestHash=value;
    else if(key==='--duration-ms'&&durationMs===undefined&&/^[1-9][0-9]*$/.test(value))durationMs=Number(value);
    else throw new TypeError(`unknown or duplicate topology option: ${key}`);
    i++;
  }
  if(!manifestHash)throw new TypeError('usage: admin1-topology-cli.ts --manifest-hash <sha256> [--duration-ms <1..120000>]');
  const controller=new AbortController();const stop=()=>controller.abort(new Error('Admin1 topology interrupted by signal'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const result=await runAdmin1Topology({repositoryRoot,manifestHash,durationMs,signal:controller.signal});
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode=topologyExitCode(result.report);
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{await main();}catch(error){process.stderr.write(`Admin1 topology failed: ${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;}
}
