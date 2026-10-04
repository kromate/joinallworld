/** Transaction-local views over the existing Worker tables. No mutable document survives a transaction. */
export function createSqliteStore(storage, { beforeCommit } = {}) {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS sessions (secret TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS archived_lives (public_id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS action_receipts (sender TEXT NOT NULL, action_id TEXT NOT NULL, action_at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(sender,action_id))');
  sql.exec('CREATE INDEX IF NOT EXISTS action_expiry ON action_receipts(action_at)');
  sql.exec('CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
  let serial = Promise.resolve(), failed = false;
  function view() {
    const sessions = new Map(), archives = new Map(), collections = new Map(), receipts = new Map();
    function lazyMap(cache, keys, load) {
      let known;
      const storedKeys = () => known ??= new Set(keys());
      return new Proxy(Object.create(null), {
        get(_, key) { if (typeof key !== 'string') return undefined; if (!cache.has(key)) cache.set(key, load(key)); return cache.get(key); },
        set(_, key, value) { if (typeof key !== 'string') throw Error('invalid_store_key'); cache.set(key, value); return true; },
        deleteProperty(_, key) { cache.set(key, undefined); return true; },
        ownKeys() { return [...new Set([...storedKeys(), ...cache.keys()])].filter(key => !cache.has(key) || cache.get(key) !== undefined); },
        getOwnPropertyDescriptor(_, key) { if ((cache.has(key) && cache.get(key) !== undefined) || (!cache.has(key) && storedKeys().has(key))) return { enumerable: true, configurable: true }; },
        has(_, key) { return cache.has(key) ? cache.get(key) !== undefined : storedKeys().has(key); },
      });
    }
    function actions(publicId, legacy = {}) {
      let entry = receipts.get(publicId);
      if (!entry) {
        const cache = new Map(Object.entries(legacy));
        const original = new Map();
        const map = lazyMap(cache,
          () => sql.exec('SELECT action_id FROM action_receipts WHERE sender = ?', publicId).toArray().map(row => row.action_id),
          key => { const row = sql.exec('SELECT value FROM action_receipts WHERE sender = ? AND action_id = ?', publicId, key).toArray()[0]; original.set(key, row?.value); return row ? JSON.parse(row.value) : undefined; });
        entry = { cache, original, map }; receipts.set(publicId, entry);
      }
      return entry.map;
    }
    const originals = { sessions: new Map(), archives: new Map(), collections: new Map() };
    const sessionMap = lazyMap(sessions, () => sql.exec('SELECT secret FROM sessions').toArray().map(row => row.secret), key => {
      const row = sql.exec('SELECT value FROM sessions WHERE secret = ?', key).toArray()[0]; originals.sessions.set(key, row?.value);
      if (!row) return undefined;
      const session = JSON.parse(row.value); session.actions = actions(session.publicId, session.actions || {}); return session;
    });
    const archiveMap = lazyMap(archives, () => sql.exec('SELECT public_id FROM archived_lives').toArray().map(row => row.public_id), key => {
      const row = sql.exec('SELECT value FROM archived_lives WHERE public_id = ?', key).toArray()[0]; originals.archives.set(key, row?.value); return row ? JSON.parse(row.value) : undefined;
    });
    const db = new Proxy({ version: 1, sessions: sessionMap, archivedLives: archiveMap }, {
      get(target, key) {
        if (key === '$store') return {
          scanSessions: predicate => sql.exec('SELECT secret,value FROM sessions').toArray().filter(row => predicate(JSON.parse(row.value))).map(row => row.secret),
          sessionKeyByPublicId: publicId => {
            for (const [key, session] of sessions) if (session?.publicId === publicId) return key;
            return sql.exec('SELECT secret FROM sessions WHERE public_id = ?', publicId).toArray()[0]?.secret;
          },
        };
        if (Object.hasOwn(target, key)) return target[key];
        if (typeof key !== 'string') return undefined;
        if (!collections.has(key)) { const row = sql.exec('SELECT value FROM collections WHERE name = ?', key).toArray()[0]; originals.collections.set(key, row?.value); collections.set(key, row ? JSON.parse(row.value) : undefined); }
        return collections.get(key);
      },
      set(target, key, value) { if (Object.hasOwn(target, key)) target[key] = value; else collections.set(key, value); return true; },
    });
    function commit() {
      beforeCommit?.();
      storage.transactionSync(() => {
        for (const [key, session] of sessions) {
          if (session === undefined) { sql.exec('DELETE FROM sessions WHERE secret = ?', key); continue; }
          if (!receipts.has(session.publicId)) actions(session.publicId, session.actions || {});
          const { actions: ignored, ...record } = session;
          const value = JSON.stringify(record);
          if (value !== originals.sessions.get(key)) sql.exec('INSERT INTO sessions(secret,public_id,expires_at,value) VALUES(?,?,?,?) ON CONFLICT(secret) DO UPDATE SET public_id=excluded.public_id,expires_at=excluded.expires_at,value=excluded.value', key, session.publicId, session.expiresAt, value);
        }
        for (const [publicId, entry] of receipts) for (const [id, receipt] of entry.cache) {
          if (receipt === undefined) sql.exec('DELETE FROM action_receipts WHERE sender = ? AND action_id = ?', publicId, id);
          else { const value = JSON.stringify(receipt); if (value !== entry.original.get(id)) sql.exec('INSERT INTO action_receipts(sender,action_id,action_at,value) VALUES(?,?,?,?) ON CONFLICT(sender,action_id) DO UPDATE SET action_at=excluded.action_at,value=excluded.value', publicId, id, receipt.actionAt, value); }
        }
        for (const [key, item] of archives) {
          if (item === undefined) sql.exec('DELETE FROM archived_lives WHERE public_id = ?', key);
          else { const value = JSON.stringify(item); if (value !== originals.archives.get(key)) sql.exec('INSERT INTO archived_lives(public_id,value) VALUES(?,?) ON CONFLICT(public_id) DO UPDATE SET value=excluded.value', key, value); }
        }
        for (const [key, item] of collections) {
          if (item === undefined) continue;
          const value = JSON.stringify(item); if (value !== originals.collections.get(key)) sql.exec('INSERT INTO collections(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value', key, value);
        }
      });
    }
    return { db, commit };
  }
  function run(fn, options, write) {
    const operation = serial.then(async () => {
      if (failed) throw Error('storage_unavailable');
      const draft = view();
      const result = await fn(draft.db);
      if (write) {
        draft.commit();
        // Every acknowledgement is durable. A failed barrier is uncertain: fail closed until restart.
        try { await storage.sync(); } catch (error) { failed = true; throw error; }
        options?.committed?.(result);
      }
      return result;
    });
    serial = operation.catch(() => {});
    return operation;
  }
  return { transact: (fn, options) => run(fn, options, true), read: fn => run(fn, null, false), stats: () => ({ mode: 'sqlite', failed }) };
}
