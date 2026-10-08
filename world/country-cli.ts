import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { acquireCountrySource, validateCountryCaptureSpec } from './country-acquire.ts';
import { inspectCountrySource } from './country-inspect.ts';
import { validateInventoryPin } from './bootstrap.ts';

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function usage(): never {
  console.error('Usage: node --experimental-strip-types world/country-cli.ts <capture|verify-source|inspect> <country-capture.json> [--duration-ms <integer>]');
  process.exit(2);
}
try {
  const [command, filename, ...args] = process.argv.slice(2);
  if (!command || !['capture', 'verify-source', 'inspect'].includes(command) || !filename) usage();
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--duration-ms' || !/^[1-9][0-9]{0,5}$/.test(args[1]!))) usage();
  const specPath = path.resolve(repositoryRoot, filename);
  const relative = path.relative(repositoryRoot, specPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('country capture spec must be inside this repository');
  const spec = validateCountryCaptureSpec(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedLocalFile(specPath, 64 * 1024))) as unknown);
  const durationMs = args.length ? Number(args[1]) : undefined;
  if (command === 'inspect') {
    const baselinePath = path.join(repositoryRoot, 'world', 'inventory-sources.json');
    const baselinePin = validateInventoryPin(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedLocalFile(baselinePath, 64 * 1024))) as unknown);
    const result = await inspectCountrySource({ repositoryRoot, spec, baselinePin, ...(durationMs ? { durationMs } : {}) });
    const report = result.report;
    process.stdout.write(`${JSON.stringify({ reportHash: result.reportHash, reportPath: result.reportPath, elapsedMs: result.elapsedMs, networkBytes: result.networkBytes,
      source: report.source, sourceUnits: report.sourceUnits, nodes: report.nodes, outlines: report.outlines,
      sourceCoordinatePositions: report.sourceCoordinatePositions, emittedOutlinePositions: report.coordinatePositions,
      largestOutlineBytes: report.largestOutlineBytes, oversizedOutlines: report.oversizedOutlines,
      identity: { retained: report.identity.retained.length, added: report.identity.added.length, missing: report.identity.missing.length },
      publishedPreview: false })}\n`);
  } else {
    const result = await acquireCountrySource(spec, { repositoryRoot, ...(durationMs ? { durationMs } : {}), ...(command === 'verify-source' ? { cacheOnly: true } : {}) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
