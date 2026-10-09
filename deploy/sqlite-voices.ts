import type { SqliteStorage } from './cf-types.ts';
import type { VoiceStore, StoredVoice } from '../server/types.ts';

interface Row { id: string; conv: string; at: number; size: number; type: string; durationMs: number; [column: string]: string | number | null | ArrayBuffer }

export function createSqliteVoices(storage: SqliteStorage): VoiceStore {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS chat_voice_notes (id TEXT PRIMARY KEY, conv TEXT NOT NULL, at INTEGER NOT NULL, size INTEGER NOT NULL, type TEXT NOT NULL, durationMs INTEGER NOT NULL, bytes BLOB NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS chat_voice_notes_conv ON chat_voice_notes(conv)');
  sql.exec('CREATE INDEX IF NOT EXISTS chat_voice_notes_at ON chat_voice_notes(at)');
  const kind = (type: string): StoredVoice['type'] | null => (type === 'webm-opus' ? type : null);
  const remove = async (ids: readonly string[]): Promise<void> => { if (ids.length) storage.transactionSync(() => { for (const id of ids) sql.exec('DELETE FROM chat_voice_notes WHERE id = ?', id); }); };
  return {
    async put(image, bytes) {
      sql.exec('INSERT INTO chat_voice_notes(id,conv,at,size,type,durationMs,bytes) VALUES(?,?,?,?,?,?,?)', image.id, image.conv, image.at, image.size, image.type, image.durationMs, bytes);
    },
    async get(id) {
      const row = sql.exec<Row & { bytes: ArrayBuffer }>('SELECT id,conv,at,size,type,durationMs,bytes FROM chat_voice_notes WHERE id = ?', id).toArray()[0], type = row ? kind(row.type) : null;
      return row && type ? { voice: { id: row.id, conv: row.conv, at: row.at, size: row.size, durationMs: row.durationMs, type }, bytes: new Uint8Array(row.bytes) } : null;
    },
    remove,
    async removeConv(convs) { storage.transactionSync(() => { for (const conv of convs) sql.exec('DELETE FROM chat_voice_notes WHERE conv = ?', conv); }); },
    async trim(before, maxBytes) {
      const removed: string[] = [];
      for (const row of sql.exec<{ id: string }>('SELECT id FROM chat_voice_notes WHERE at < ?', before).toArray()) removed.push(row.id);
      await remove(removed);
      let total = sql.exec<{ total: number | null }>('SELECT SUM(size) AS total FROM chat_voice_notes').toArray()[0]?.total ?? 0;
      while (total > maxBytes) {
        const oldest = sql.exec<{ id: string; size: number }>('SELECT id,size FROM chat_voice_notes ORDER BY at LIMIT 20').toArray();
        if (!oldest.length) break;
        const batch: string[] = [];
        for (const row of oldest) { batch.push(row.id); total -= row.size; if (total <= maxBytes) break; }
        await remove(batch); removed.push(...batch);
      }
      return removed;
    },
    async stats() { const row = sql.exec<{ count: number; bytes: number | null }>('SELECT COUNT(*) AS count, SUM(size) AS bytes FROM chat_voice_notes').toArray()[0]; return { count: row?.count ?? 0, bytes: row?.bytes ?? 0 }; },
  };
}
