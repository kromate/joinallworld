/**
 * The committed state of the layered collections held in memory: what the Node host keeps (server/store.ts), and what the
 * layer's tests read from. A root text per collection and, per keyed map, the entry texts in the order they were added.
 */
import { assembleText, splitText } from './keyed.ts';
import type { CollectionWrite, LayerSource } from './keyed.ts';

export class MemoryLayers implements LayerSource {
  private readonly roots = new Map<string, string>();
  private readonly data = new Map<string, Map<string, Map<string, string>>>();
  root(coll: string): { text: string; stored: string } | undefined { const text = this.roots.get(coll); return text === undefined ? undefined : { text, stored: text }; }
  entry(coll: string, id: string, key: string): { text: string; stored: string } | undefined { const text = this.data.get(coll)?.get(id)?.get(key); return text === undefined ? undefined : { text, stored: text }; }
  keys(coll: string, id: string): string[] { return [...this.data.get(coll)?.get(id)?.keys() ?? []]; }
  collections(): string[] { return [...this.roots.keys()]; }
  /** Take a collection's stored text in (start-up, or a collection that was just made). */
  ingest(coll: string, text: string): void {
    const split = splitText(coll, text);
    this.roots.set(coll, split.rootText);
    const maps = new Map<string, Map<string, string>>();
    for (const map of split.maps) maps.set(map.id, new Map(map.entries));
    this.data.set(coll, maps);
  }
  /** The collection's whole text, as it was stored before it was split. */
  text(coll: string): string | undefined {
    const root = this.roots.get(coll);
    if (root === undefined) return undefined;
    return assembleText(root, (id) => this.data.get(coll)?.get(id) ?? []);
  }
  /** JSON characters held by a collection (its root and every entry). */
  size(coll: string): number {
    let total = this.roots.get(coll)?.length ?? 0;
    for (const map of this.data.get(coll)?.values() ?? []) for (const [key, text] of map) total += key.length + text.length + 4;
    return total;
  }
  /** Apply writes. Answers the steps that put everything back exactly as it was (run them last to first). */
  apply(writes: readonly CollectionWrite[]): (() => void)[] {
    const undo: (() => void)[] = [];
    for (const write of writes) {
      const { coll } = write;
      const hadRoot = this.roots.get(coll), hadMaps = this.data.get(coll);
      if (write.removed) {
        this.roots.delete(coll); this.data.delete(coll);
        undo.push(() => { if (hadRoot !== undefined) this.roots.set(coll, hadRoot); if (hadMaps) this.data.set(coll, hadMaps); });
        continue;
      }
      if (write.root) { this.roots.set(coll, write.root.text); undo.push(() => { if (hadRoot === undefined) this.roots.delete(coll); else this.roots.set(coll, hadRoot); }); }
      let maps = this.data.get(coll);
      if (!maps) { const made = maps = new Map(); this.data.set(coll, made); undo.push(() => { if (hadMaps) this.data.set(coll, hadMaps); else this.data.delete(coll); }); }
      for (const change of write.maps) {
        const live = maps;
        const before = live.get(change.id);
        let map = before;
        if (!map) { const made = map = new Map<string, string>(); live.set(change.id, made); undo.push(() => { if (before) live.set(change.id, before); else live.delete(change.id); }); }
        if (change.deletes.length) {
          // A map that loses keys is rebuilt, so that putting it back keeps every key where it was.
          const gone = new Set(change.deletes), rebuilt = new Map<string, string>();
          for (const [key, text] of map) if (!gone.has(key)) rebuilt.set(key, text);
          const old = map;
          live.set(change.id, rebuilt); map = rebuilt;
          undo.push(() => { live.set(change.id, old); });
        }
        const target = map;
        for (const put of change.puts) {
          const had = target.get(put.key);
          target.set(put.key, put.text);
          undo.push(() => { if (had === undefined) target.delete(put.key); else target.set(put.key, had); });
        }
      }
    }
    return undo;
  }
}
