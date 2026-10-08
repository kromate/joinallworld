import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapInventory } from './bootstrap.ts';

const repository=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try{
  if(process.argv.slice(2).length)throw new Error('Usage: node --experimental-strip-types world/bootstrap-cli.ts');
  const pin=JSON.parse(await readFile(path.join(repository,'world','inventory-sources.json'),'utf8')) as unknown;
  console.log(JSON.stringify(await bootstrapInventory(pin,repository,path.join(repository,'.cache','world-build')),null,2));
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
