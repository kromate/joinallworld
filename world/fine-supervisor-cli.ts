import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runFineSupervisor } from './fine-supervisor.ts';

const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function main():Promise<void>{
 const [command,configPath,...extra]=process.argv.slice(2),controller=new AbortController();
 const stop=():void=>controller.abort(new Error('fine supervisor interrupted by signal'));
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  if(command!=='run'||!configPath||extra.length)throw new TypeError('usage: fine-supervisor-cli.ts run world/fine-supervisor.json');
  const result=await runFineSupervisor({repositoryRoot,configPath,signal:controller.signal});
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
 }catch(error){process.stderr.write(`fine supervisor failed: ${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;}
 finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
