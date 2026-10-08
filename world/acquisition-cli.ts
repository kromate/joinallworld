import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireRegion } from './acquire.ts';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function usage():never { console.error('Usage: node --experimental-strip-types world/acquisition-cli.ts <request.json> [--python /absolute/path/to/python3.12]'); process.exit(2); }
try {
  const args=process.argv.slice(2);if(!args.length||args.length>3)usage();
  const file=path.resolve(root,args[0]!);let python=process.env.WORLD_PYTHON ?? path.join(root,'.cache/world-build/tooling/venv/bin/python3');
  if(args.length===3){if(args[1]!=='--python')usage();python=args[2]!;}
  const request=JSON.parse(await readFile(file,'utf8')) as unknown;
  const result=await acquireRegion(request as never,{pythonExecutable:python,allowedRoot:path.join(root,'.cache/world-build')});
  console.log(JSON.stringify({requestHash:result.requestHash,plan:result.plan,receiptPath:result.receiptPath,metrics:result.metrics,upstream:result.upstream,exceptions:result.exceptions},null,2));
} catch(error) { console.error(error instanceof Error?error.message:String(error));process.exitCode=1; }
