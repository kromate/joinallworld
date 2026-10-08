import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireSettlementSource } from './settlement-acquire.ts';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { SETTLEMENT_CAPTURE_LIMITS } from './settlement-types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(args: string[]): { cacheOnly: boolean; durationMs?: number } {
  let cacheOnly = false, durationMs: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--cache-only') {
      if (cacheOnly) throw new Error('duplicate --cache-only');
      cacheOnly = true;
    } else if (arg === '--duration-ms') {
      if (durationMs !== undefined) throw new Error('duplicate --duration-ms');
      const value = args[++i];
      if (!value || !/^\d+$/.test(value)) throw new Error('--duration-ms must be an integer from 1 to 120000');
      durationMs = Number(value);
      if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > SETTLEMENT_CAPTURE_LIMITS.durationMs) throw new Error('--duration-ms must be an integer from 1 to 120000');
    } else throw new Error(`unknown settlement capture option: ${arg}`);
  }
  return { cacheOnly, ...(durationMs === undefined ? {} : { durationMs }) };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(here, '..');
  const pinPath = path.join(here, 'settlement-capture.json');
  const bytes = await readBoundedLocalFile(pinPath, 16 * 1024);
  const pin: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const controller = new AbortController();
  const abort = (signal: NodeJS.Signals) => controller.abort(new Error(`Settlement capture interrupted by ${signal}`));
  const onInt = () => abort('SIGINT'), onTerm = () => abort('SIGTERM');
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  try {
    const result = await acquireSettlementSource(pin, { repositoryRoot: root, signal: controller.signal, ...options });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
  }
}

main().catch(error => {
  const text = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${Buffer.from(text).subarray(0, 2048).toString('utf8')}\n`);
  process.exitCode = 1;
});
