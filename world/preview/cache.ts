/** Small byte-accounted LRU for validated tile payloads; active meshes are managed separately. */
export class ByteLru<K, V> {
  private readonly entries = new Map<K, { value: V; bytes: number }>();
  private used = 0;
  readonly maxBytes: number;
  private readonly dispose?: (value: V) => void;

  constructor(maxBytes: number, dispose?: (value: V) => void) {
    this.maxBytes = maxBytes;
    this.dispose = dispose;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('maxBytes must be a non-negative safe integer');
  }

  get byteLength(): number { return this.used; }
  get size(): number { return this.entries.size; }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('bytes must be a non-negative safe integer');
    this.delete(key);
    if (bytes > this.maxBytes) { this.dispose?.(value); return; }
    while (this.used + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
    this.entries.set(key, { value, bytes });
    this.used += bytes;
  }

  delete(key: K): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.used -= entry.bytes;
    this.dispose?.(entry.value);
  }

  clear(): void { for (const key of this.entries.keys()) this.delete(key); }
}
