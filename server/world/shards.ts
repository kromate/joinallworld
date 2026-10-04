/**
 * OWNER: world
 * SHARD STORE, NODE BACKEND — one append-only log FILE per shard: `<dataDir>/world/<city>.<lga>.log`.
 *
 * The store itself (the interface, the guarantee, what one request costs, compaction) is server/world/shard-core.ts,
 * shared with the Worker host. This file only says where a log lives on the Node host: a file appended to in place,
 * compacted through a temporary file and a rename, with a small `summary.json` beside the logs.
 *   A transaction whose promise RESOLVES is in the file (appended; not fsynced, so it survives a crash of the
 *   process, not necessarily a power cut). A line cut off by a crash is ignored when the file is read.
 *
 * `io` ({ readFile, appendFile, writeFile, rename, stat }) replaces the file calls in tests.
 */
import { mkdir, readFile, appendFile, writeFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createShardStoreOn } from './shard-core.ts';
import type { ShardOptions, ShardStoreOn } from './shard-core.ts';

/** The file calls the Node backend makes; tests replace any of them. */
export interface ShardFileIo {
  readFile(path: string, encoding: 'utf8'): Promise<string>
  appendFile(path: string, text: string, options: { mode: number }): Promise<void>
  writeFile(path: string, text: string, options: { mode: number }): Promise<void>
  rename(from: string, to: string): Promise<void>
  stat(path: string): Promise<{ size: number }>
}

export async function createShardStore<S extends object, R extends readonly unknown[]>(dir: string, { io = {}, ...options }: Partial<ShardOptions<S, R>> & { io?: Partial<ShardFileIo> } = {}): Promise<ShardStoreOn<S, R> & { dir: string }> {
  const fs = { readFile: io.readFile ?? readFile, appendFile: io.appendFile ?? appendFile, writeFile: io.writeFile ?? writeFile, rename: io.rename ?? rename, stat: io.stat ?? stat };
  await mkdir(dir, { recursive: true });
  const fileOf = (name: string): string => join(dir, `${name}.log`);
  const store = createShardStoreOn({
    async read(name: string) { try { return await fs.readFile(fileOf(name), 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return ''; } },
    append: (name: string, text: string) => fs.appendFile(fileOf(name), text, { mode: 0o600 }),
    async replace(name: string, text: string) { const file = fileOf(name); await fs.writeFile(`${file}.tmp`, text, { mode: 0o600 }); await fs.rename(`${file}.tmp`, file); },
    async size(name: string) { return (await fs.stat(fileOf(name))).size; },
    async readMeta() { return JSON.parse(await fs.readFile(join(dir, 'summary.json'), 'utf8')); },
    async writeMeta(value: unknown) { const file = join(dir, 'summary.json'); await fs.writeFile(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 }); await fs.rename(`${file}.tmp`, file); },
  }, options);
  return { ...store, dir };
}
