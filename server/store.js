import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

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
