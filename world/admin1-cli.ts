import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { acquireAdmin1Source } from './admin1-acquire.ts';
import { inspectAdmin1Source } from './admin1-inspect.ts';
import { publishAdmin1Source } from './admin1-publish.ts';
import type { Admin1ParentPin, Admin1SourcePin } from './admin1-types.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function readNamedConfig(name: string): Promise<unknown> {
  if (!/^world\/[a-z0-9][a-z0-9-]*\.json$/.test(name)) throw new TypeError('configuration must be a named world/*.json file');
  const bytes = await readBoundedLocalFile(path.join(repositoryRoot, name), 64 * 1024);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function sourcePin(value: unknown): Admin1SourcePin {
  const row = object(value, 'source pin');
  if (Object.keys(row).length !== 4 || row.schemaVersion !== 1 || !row.source || typeof row.input !== 'string' || typeof row.gitBlobSha1 !== 'string') throw new TypeError('invalid source pin shape');
  // The inspector validates the complete source, exact path and hashes before using it.
  return row as unknown as Admin1SourcePin;
}
function parentPin(value: unknown): Admin1ParentPin {
  const row = object(value, 'parent pin');
  if (Object.keys(row).length !== 4 || typeof row.manifestHash !== 'string' || row.directoryRoot !== '.cache/world-build/output/country-inventory' || !row.source || typeof row.input !== 'string') throw new TypeError('invalid parent pin shape');
  return row as unknown as Admin1ParentPin;
}
async function main(): Promise<void> {
  const [command, config, parent, inspection, ...extra] = process.argv.slice(2);
  const controller = new AbortController();
  const stop = (): void => controller.abort(new Error('Admin 1 operation interrupted by signal'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (!config || extra.length || !['capture', 'cached', 'inspect', 'publish'].includes(command ?? '')
      || (command === 'publish' ? !parent || !inspection : command === 'inspect' ? !parent || inspection !== undefined : parent !== undefined || inspection !== undefined))
      throw new TypeError('usage: admin1-cli.ts capture|cached world/admin1-capture.json OR inspect world/admin1-sources.json world/admin1-parent.json OR publish world/admin1-sources.json world/admin1-parent.json world/admin1-inspection.json');
    const value = await readNamedConfig(config);
    let result: unknown;
    if (command === 'publish') {
      const pin = object(await readNamedConfig(inspection!), 'inspection pin');
      if (Object.keys(pin).length !== 2 || typeof pin.reportHash !== 'string' || typeof pin.reportPath !== 'string') throw new TypeError('invalid inspection pin shape');
      result = await publishAdmin1Source({ repositoryRoot, sourcePin: sourcePin(value), parentPin: parentPin(await readNamedConfig(parent!)), inspectionHash: pin.reportHash, inspectionPath: pin.reportPath, signal: controller.signal });
    } else result = command === 'inspect'
      ? await inspectAdmin1Source({ repositoryRoot, sourcePin: sourcePin(value), parentPin: parentPin(await readNamedConfig(parent!)), signal: controller.signal })
      : await acquireAdmin1Source(value, { repositoryRoot, cacheOnly: command === 'cached', signal: controller.signal });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Admin 1 operation failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1;
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
