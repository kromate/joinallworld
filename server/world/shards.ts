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

export async function createShardStore(dir, { io = {}, ...options } = {}) {
  const fs = { readFile: io.readFile ?? readFile, appendFile: io.appendFile ?? appendFile, writeFile: io.writeFile ?? writeFile, rename: io.rename ?? rename, stat: io.stat ?? stat };
  await mkdir(dir, { recursive: true });
  const fileOf = (name) => join(dir, `${name}.log`);
  const store = createShardStoreOn({
    async read(name) { try { return await fs.readFile(fileOf(name), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; return ''; } },
    append: (name, text) => fs.appendFile(fileOf(name), text, { mode: 0o600 }),
    async replace(name, text) { const file = fileOf(name); await fs.writeFile(`${file}.tmp`, text, { mode: 0o600 }); await fs.rename(`${file}.tmp`, file); },
    async size(name) { return (await fs.stat(fileOf(name))).size; },
    async readMeta() { return JSON.parse(await fs.readFile(join(dir, 'summary.json'), 'utf8')); },
    async writeMeta(value) { const file = join(dir, 'summary.json'); await fs.writeFile(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 }); await fs.rename(`${file}.tmp`, file); },
  }, options);
  return { ...store, dir };
}
