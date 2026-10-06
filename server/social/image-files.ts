/**
 * OWNER: social
 * The picture store on the Node host: one file of bytes and one small file of facts per picture, in a folder of its own beside
 * the data file (DATA_DIR/chat-images). Nothing here is in the data file, so a picture never makes the collection larger.
 * The Worker keeps the same facts in a SQLite table instead (deploy/sqlite-images.ts); both answer to ImageStore.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImageStore, StoredImage } from '../types.ts';
import { PICTURE_LIMITS } from './images.ts';

const isStored = (value: unknown): value is StoredImage => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['id'] === 'string' && PICTURE_LIMITS.idPattern.test(v['id']) && typeof v['conv'] === 'string' && typeof v['at'] === 'number' && typeof v['size'] === 'number' && (v['type'] === 'jpeg' || v['type'] === 'png' || v['type'] === 'webp');
};

export function createFileImages(dir: string): ImageStore {
  let index: Map<string, StoredImage> | null = null;
  const bytesPath = (id: string): string => join(dir, `${id}.img`), factsPath = (id: string): string => join(dir, `${id}.json`);
  async function load(): Promise<Map<string, StoredImage>> {
    if (index) return index;
    const found = new Map<string, StoredImage>();
    await mkdir(dir, { recursive: true });
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.json')) continue;
      try { const facts: unknown = JSON.parse(await readFile(join(dir, name), 'utf8')); if (isStored(facts)) found.set(facts.id, facts); } catch { /* a half-written fact file is a picture that never arrived */ }
    }
    return (index = found);
  }
  async function drop(ids: readonly string[]): Promise<void> {
    const known = await load();
    for (const id of ids) {
      if (!PICTURE_LIMITS.idPattern.test(id)) continue;
      known.delete(id);
      await rm(factsPath(id), { force: true }); await rm(bytesPath(id), { force: true });
    }
  }
  return {
    async put(image, bytes) {
      const known = await load();
      if (!PICTURE_LIMITS.idPattern.test(image.id)) throw new Error('bad picture id');
      // The bytes first, then the facts: a picture is there only once its facts are.
      const temp = `${bytesPath(image.id)}.tmp`;
      await writeFile(temp, bytes, { mode: 0o600 }); await rename(temp, bytesPath(image.id));
      await writeFile(factsPath(image.id), JSON.stringify(image), { mode: 0o600 });
      known.set(image.id, image);
    },
    async get(id) {
      const known = await load(), image = PICTURE_LIMITS.idPattern.test(id) ? known.get(id) : undefined;
      if (!image) return null;
      try { return { image, bytes: new Uint8Array(await readFile(bytesPath(id))) }; } catch { return null; }
    },
    remove: drop,
    async removeConv(convs) {
      const known = await load(), wanted = new Set(convs);
      await drop([...known.values()].filter((image) => wanted.has(image.conv)).map((image) => image.id));
    },
    async trim(before, maxBytes) {
      const known = await load(), removed: string[] = [];
      const all = [...known.values()].sort((a, b) => a.at - b.at);
      let total = all.reduce((sum, image) => sum + image.size, 0);
      for (const image of all) {
        if (image.at >= before && total <= maxBytes) break;
        removed.push(image.id); total -= image.size;
      }
      await drop(removed);
      return removed;
    },
    async stats() { const known = await load(); return { count: known.size, bytes: [...known.values()].reduce((sum, image) => sum + image.size, 0) }; },
  };
}
