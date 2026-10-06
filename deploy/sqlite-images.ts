/**
 * THE PICTURE STORE ON THE WORKER HOST: one row of the Durable Object's SQLite table `chat_images` per picture, with the bytes
 * in it (at most 250 kB, far below the 2 MB row limit). The `social` collection holds only the picture's id.
 *
 * ROW COST. A picture written is 3 rows written: the row itself and its two index entries (by conversation, by time). A picture
 * deleted is the same again. Nothing is read or written for a poll, a room, a heartbeat or a message without a picture; a
 * picture read is 1 row read. The whole table is trimmed by time and size by `trim` (called at most once an hour, and when a
 * picture is added), which reads index entries only until it finds something to delete.
 */
import type { SqliteStorage } from './cf-types.ts';
import type { ImageStore, StoredImage } from '../server/types.ts';

interface Row { id: string; conv: string; at: number; size: number; type: string; [column: string]: string | number | null | ArrayBuffer }

export function createSqliteImages(storage: SqliteStorage): ImageStore {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS chat_images (id TEXT PRIMARY KEY, conv TEXT NOT NULL, at INTEGER NOT NULL, size INTEGER NOT NULL, type TEXT NOT NULL, bytes BLOB NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS chat_images_conv ON chat_images(conv)');
  sql.exec('CREATE INDEX IF NOT EXISTS chat_images_at ON chat_images(at)');
  const kind = (type: string): StoredImage['type'] | null => (type === 'jpeg' || type === 'png' || type === 'webp' ? type : null);
  const remove = async (ids: readonly string[]): Promise<void> => { if (ids.length) storage.transactionSync(() => { for (const id of ids) sql.exec('DELETE FROM chat_images WHERE id = ?', id); }); };
  return {
    async put(image, bytes) {
      sql.exec('INSERT INTO chat_images(id,conv,at,size,type,bytes) VALUES(?,?,?,?,?,?)', image.id, image.conv, image.at, image.size, image.type, bytes);
    },
    async get(id) {
      const row = sql.exec<Row & { bytes: ArrayBuffer }>('SELECT id,conv,at,size,type,bytes FROM chat_images WHERE id = ?', id).toArray()[0], type = row ? kind(row.type) : null;
      return row && type ? { image: { id: row.id, conv: row.conv, at: row.at, size: row.size, type }, bytes: new Uint8Array(row.bytes) } : null;
    },
    remove,
    async removeConv(convs) { storage.transactionSync(() => { for (const conv of convs) sql.exec('DELETE FROM chat_images WHERE conv = ?', conv); }); },
    async trim(before, maxBytes) {
      const removed: string[] = [];
      for (const row of sql.exec<{ id: string }>('SELECT id FROM chat_images WHERE at < ?', before).toArray()) removed.push(row.id);
      await remove(removed);
      let total = sql.exec<{ total: number | null }>('SELECT SUM(size) AS total FROM chat_images').toArray()[0]?.total ?? 0;
      while (total > maxBytes) {
        const oldest = sql.exec<{ id: string; size: number }>('SELECT id,size FROM chat_images ORDER BY at LIMIT 20').toArray();
        if (!oldest.length) break;
        const batch: string[] = [];
        for (const row of oldest) { batch.push(row.id); total -= row.size; if (total <= maxBytes) break; }
        await remove(batch); removed.push(...batch);
      }
      return removed;
    },
    async stats() { const row = sql.exec<{ count: number; bytes: number | null }>('SELECT COUNT(*) AS count, SUM(size) AS bytes FROM chat_images').toArray()[0]; return { count: row?.count ?? 0, bytes: row?.bytes ?? 0 }; },
  };
}
