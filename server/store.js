import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * JSON file store (Node only). The storage interface the rest of the server relies on is just:
 *   transact(fn(db)) → Promise<result>   serialised read-modify-write; a throw discards changes
 *   read(fn(db))     → Promise<result>   read-only snapshot
 * over one JSON document `{ version, sessions, archivedLives?, <namespaced collections> }`.
 * Route and ws modules reach their own collection with collection(db, name) from protocol.js,
 * which creates it on first use; nothing outside this file may assume a file on disk.
 */
export async function createStore(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const file = join(dataDir, 'devices.json');
  let database;
  try {
    database = JSON.parse(await readFile(file, 'utf8'));
    if (database.version !== 1 || !database.sessions || typeof database.sessions !== 'object') throw new Error('Invalid device database');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    database = { version: 1, sessions: {} };
  }
  let pending = Promise.resolve();
  return {
    transact(operation) {
      const work = pending.then(async () => {
        const next = structuredClone(database);
        const value = await operation(next);
        const temporary = `${file}.tmp`;
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        await rename(temporary, file);
        database = next;
        return value;
      });
      pending = work.catch(() => {});
      return work;
    },
    read(operation) { return pending.then(() => operation(structuredClone(database))); },
  };
}
