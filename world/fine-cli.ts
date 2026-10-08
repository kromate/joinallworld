import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { runFineBuild } from './fine-run.ts';
import { validateFineSourcePin } from './fine.ts';
import { acquireFineSource } from './fine-acquire.ts';
import { runFineTopology } from './fine-topology.ts';
import type { FineSourcePin } from './fine-types.ts';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHA256 = /^[a-f0-9]{64}$/;

function usage(): never {
  console.error('Usage: node --experimental-strip-types world/fine-cli.ts build <fine-sources.json> --inventory-hash <sha256> [--registry <cache-file> --migration <cache-file>]\n       node --experimental-strip-types world/fine-cli.ts acquire <fine-sources.json> [--duration-ms <1..120000>]\n       node --experimental-strip-types world/fine-cli.ts verify-source <fine-sources.json>\n       node --experimental-strip-types world/fine-cli.ts topology <fine-sources.json> [--duration-ms <1..60000>]');
  process.exit(2);
}
function insideRepository(target: string): boolean {
  const relative = path.relative(repoRoot, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

try {
  const [command, pinFilename, ...args] = process.argv.slice(2);
  if (!['build', 'acquire', 'verify-source', 'topology'].includes(command ?? '') || !pinFilename) usage();
  const allowedFlags = command === 'build' ? ['--inventory-hash', '--registry', '--migration'] : ['acquire', 'topology'].includes(command!) ? ['--duration-ms'] : [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!allowedFlags.includes(flag ?? '') || !value || flags.has(flag!)) usage();
    flags.set(flag!, value);
  }
  const pinPath = path.resolve(repoRoot, pinFilename);
  if (!insideRepository(pinPath)) throw new Error('fine source pin file must be inside the repository');
  const pinBytes = await readBoundedLocalFile(pinPath, 64 * 1024);
  let pin: FineSourcePin;
  try { pin = validateFineSourcePin(JSON.parse(pinBytes.toString('utf8'))); }
  catch (error) { throw new TypeError(`fine source pin is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  if (command === 'acquire' || command === 'verify-source') {
    const duration = flags.get('--duration-ms');
    if (duration && !/^[1-9][0-9]{0,5}$/.test(duration)) throw new TypeError('--duration-ms must be an integer from 1 to 120000');
    const result = await acquireFineSource(pin, {
      repositoryRoot: repoRoot,
      ...(duration ? { durationMs: Number(duration) } : {}),
      ...(command === 'verify-source' ? { cacheOnly: true } : {}),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (command === 'topology') {
    const duration = flags.get('--duration-ms');
    if (duration && !/^[1-9][0-9]{0,4}$/.test(duration)) throw new TypeError('--duration-ms must be an integer from 1 to 60000');
    const result = await runFineTopology({ repositoryRoot: repoRoot, pin, ...(duration ? { durationMs: Number(duration) } : {}) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.report.invalidUnits || result.report.unsupportedUnits) process.exitCode = 2;
  } else {
    const inventoryHash = flags.get('--inventory-hash');
    if (!inventoryHash || !SHA256.test(inventoryHash)) usage();
    if (flags.has('--migration') && !flags.has('--registry')) throw new Error('--migration requires --registry');
    const result = await runFineBuild({
      repositoryRoot: repoRoot, coarseInventoryHash: inventoryHash, pin,
      ...(flags.has('--registry') ? { previousRegistryPath: flags.get('--registry')! } : {}),
      ...(flags.has('--migration') ? { migrationPath: flags.get('--migration')! } : {}),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
