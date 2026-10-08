import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { COUNTRY_GRID_LIMITS } from './country-grid-types.ts';
import { publishCountryGrid } from './country-grid-publish.ts';
import { validateCountryGridRequest } from './country-grid.ts';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.join(REPO, '.cache', 'world-build');
async function main(): Promise<void> {
  const [command, filename, ...flags] = process.argv.slice(2);
  if (command !== 'build' || !filename || flags.length) throw new Error('usage: country-grid-cli.ts build <request.json>');
  const body = await readBoundedLocalFile(path.resolve(REPO, filename), COUNTRY_GRID_LIMITS.requestBytes);
  const request = validateCountryGridRequest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)));
  const controller = new AbortController(), stop = () => controller.abort(new Error('country grid interrupted'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const product = await publishCountryGrid(request, { allowedRoot: ROOT,
      directoryRoot: path.join(ROOT, 'output', 'country-inventory'), outputRoot: path.join(ROOT, 'country-grids', request.id),
      durationMs: 60_000, memoryMb: 512, signal: controller.signal });
    process.stdout.write(`${JSON.stringify(product)}\n`);
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
main().catch(error => { process.stderr.write(`${Buffer.from(error instanceof Error ? error.message : String(error)).subarray(0, 2048).toString('utf8')}\n`); process.exitCode = 1; });
