import { parentPort, workerData } from 'node:worker_threads';
import { lstat, opendir, statfs } from 'node:fs/promises';
import path from 'node:path';
import type { InventoryNode } from './production-types.ts';
import { buildFineInventory, publishFineInventory } from './fine.ts';
import { FINE_LIMITS, type FineIdentityMigration, type FineIdentityRegistry, type FineSourcePin } from './fine-types.ts';

interface FineWorkerInput {
  pin: FineSourcePin;
  rawBuffer: ArrayBuffer;
  coarseCountry: InventoryNode;
  coarseInventoryHash: string;
  previousRegistry?: FineIdentityRegistry;
  migration?: FineIdentityMigration;
  buildRoot: string;
  outputRoot: string;
}

async function treeBytes(directory: string): Promise<number> {
  let entries = 0;
  const walk = async (current: string, depth: number): Promise<number> => {
    if (depth > 8) throw new RangeError('fine output subtree exceeds its depth-8 traversal cap');
    let info;
    try { info = await lstat(current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && current === directory) return 0; throw error; }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('fine output tree contains a symlink or non-directory');
    let total = 0;
    const handle = await opendir(current);
    for await (const entry of handle) {
      if (++entries > 4_096) throw new RangeError('fine output subtree exceeds its 4,096-entry traversal cap');
      const filename = path.join(current, entry.name), child = await lstat(filename);
      if (child.isSymbolicLink()) throw new Error('fine output tree contains a symlink');
      if (child.isDirectory()) total += await walk(filename, depth + 1);
      else if (child.isFile()) total += child.size;
      else throw new Error('fine output tree contains a non-regular entry');
      if (total > 40 * 1024 * 1024) throw new RangeError('fine output subtree exceeds its 40 MiB cumulative cap');
    }
    return total;
  };
  return walk(directory, 0);
}

async function run(): Promise<void> {
  if (!parentPort) throw new Error('fine worker must run inside a worker thread');
  const input = workerData as FineWorkerInput;
  const rawBytes = new Uint8Array(input.rawBuffer);
  const inventory = buildFineInventory(input.pin, rawBytes, input.coarseCountry, input.coarseInventoryHash,
    { ...(input.previousRegistry ? { previousRegistry: input.previousRegistry } : {}), ...(input.migration ? { migration: input.migration } : {}) });

  const disk = await statfs(input.buildRoot);
  if (disk.bavail * disk.bsize < (100 + 16) * 1024 * 1024) throw new RangeError('fine build free disk space fell below the 100 MiB reserve plus 16 MiB publication allowance');
  const currentFineBytes = await treeBytes(path.join(input.buildRoot, 'output', 'fine'));
  if (currentFineBytes + 16 * 1024 * 1024 > 40 * 1024 * 1024) throw new RangeError('fine output subtree lacks room for the maximum 16 MiB publication within its 40 MiB cumulative cap');

  const published = await publishFineInventory(inventory, input.outputRoot, input.buildRoot);
  if (published.bytes > FINE_LIMITS.publishedBytes || published.units !== input.pin.expectedUnits) throw new Error('fine publisher result differs from its byte or unit cap');
  parentPort.postMessage({ ok: true, result: published });
}

void run().catch(error => {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
}).finally(() => parentPort?.close());
