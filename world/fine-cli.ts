import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { runFineBuild } from './fine-run.ts';
import { validateFineSourcePin } from './fine.ts';
import type { FineSourcePin } from './fine-types.ts';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHA256 = /^[a-f0-9]{64}$/;

function usage(): never {
  console.error('Usage: node --experimental-strip-types world/fine-cli.ts build <fine-sources.json> --inventory-hash <sha256> [--registry <cache-file> --migration <cache-file>]');
  process.exit(2);
}
function insideRepository(target: string): boolean {
  const relative = path.relative(repoRoot, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

try {
  const [command, pinFilename, ...args] = process.argv.slice(2);
  if (command !== 'build' || !pinFilename) usage();
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!['--inventory-hash', '--registry', '--migration'].includes(flag ?? '') || !value || flags.has(flag!)) usage();
    flags.set(flag!, value);
  }
  const inventoryHash = flags.get('--inventory-hash');
  if (!inventoryHash || !SHA256.test(inventoryHash)) usage();
  if (flags.has('--migration') && !flags.has('--registry')) throw new Error('--migration requires --registry');
  const pinPath = path.resolve(repoRoot, pinFilename);
  if (!insideRepository(pinPath)) throw new Error('fine source pin file must be inside the repository');
  const pinBytes = await readBoundedLocalFile(pinPath, 64 * 1024);
  let pin: FineSourcePin;
  try { pin = validateFineSourcePin(JSON.parse(pinBytes.toString('utf8'))); }
  catch (error) { throw new TypeError(`fine source pin is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  const result = await runFineBuild({
    repositoryRoot: repoRoot, coarseInventoryHash: inventoryHash, pin,
    ...(flags.has('--registry') ? { previousRegistryPath: flags.get('--registry')! } : {}),
    ...(flags.has('--migration') ? { migrationPath: flags.get('--migration')! } : {}),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
