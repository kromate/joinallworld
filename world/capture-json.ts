/** Strict raw-capture reader. No I/O, clocks, canonicalization, indexing or game imports. */
export const CAPTURE_JSON_LIMITS = Object.freeze({ bytes: 20_000_000, nodes: 3_000_000, depth: 64 });
export interface CaptureJsonLimits { bytes: number; nodes: number; depth: number }

/**
 * Decode once, retaining every admitted property. Native JSON.parse is used only
 * for individual string/number tokens; object construction detects decoded-key
 * collisions that a normal whole-document parse would silently overwrite.
 */
export function parseCaptureJson(bytes: Uint8Array, limits: Partial<CaptureJsonLimits> = {}): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer) {
    throw new TypeError('Capture JSON requires an unshared byte snapshot.');
  }
  const cap = { ...CAPTURE_JSON_LIMITS, ...limits };
  for (const key of Object.keys(limits)) if (!Object.hasOwn(CAPTURE_JSON_LIMITS, key)) throw new TypeError('Unknown capture JSON limit.');
  for (const key of ['bytes', 'nodes', 'depth'] as const) {
    if (!Number.isSafeInteger(cap[key]) || cap[key] < 1 || cap[key] > CAPTURE_JSON_LIMITS[key]) {
      throw new RangeError(`Capture JSON ${key} limit is outside its hard bound.`);
    }
  }
  if (bytes.byteLength > cap.bytes) throw new RangeError('Capture JSON exceeds its byte limit.');
  // Preserve a BOM so the grammar rejects it, matching JSON.parse on source text.
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let offset = 0, nodes = 0;
  function invalid(message: string): never { throw new SyntaxError(`Capture JSON ${message} at character ${offset}.`); }
  function whitespace(): void {
    while (text[offset] === ' ' || text[offset] === '\t' || text[offset] === '\r' || text[offset] === '\n') offset++;
  }
  function string(): string {
    if (text[offset] !== '"') invalid('requires a quoted object key/string');
    const start = offset++;
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '\\') { offset++; continue; }
      if (character === '"') {
        try { return JSON.parse(text.slice(start, offset)) as string; }
        catch { invalid('contains an invalid string token'); }
      }
    }
    invalid('has an unterminated string');
  }
  function value(depth: number): unknown {
    if (++nodes > cap.nodes || depth > cap.depth) throw new RangeError('Capture JSON exceeds its node or depth limit.');
    whitespace();
    const character = text[offset];
    if (character === '"') return string();
    if (character === '{') {
      offset++; whitespace();
      const output: Record<string, unknown> = {}, keys = new Set<string>();
      if (text[offset] === '}') { offset++; return output; }
      for (;;) {
        const key = string();
        if (keys.has(key)) invalid('has a duplicate decoded object key');
        keys.add(key); whitespace();
        if (text[offset++] !== ':') invalid('requires a colon');
        const item = value(depth + 1);
        // Preserve __proto__ as data for the later feature admission exception.
        Object.defineProperty(output, key, { value: item, enumerable: true, writable: true, configurable: true });
        whitespace();
        const delimiter = text[offset++];
        if (delimiter === '}') return output;
        if (delimiter !== ',') invalid('requires an object comma or closing brace');
        whitespace();
      }
    }
    if (character === '[') {
      offset++; whitespace();
      const output: unknown[] = [];
      if (text[offset] === ']') { offset++; return output; }
      for (;;) {
        output.push(value(depth + 1)); whitespace();
        const delimiter = text[offset++];
        if (delimiter === ']') return output;
        if (delimiter !== ',') invalid('requires an array comma or closing bracket');
      }
    }
    for (const [word, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(word, offset)) { offset += word.length; return result; }
    }
    numberToken.lastIndex = offset;
    const numeric = numberToken.exec(text);
    if (numeric) {
      offset = numberToken.lastIndex;
      const result = JSON.parse(numeric[0]) as number;
      if (!Number.isFinite(result)) invalid('contains a nonfinite number');
      return result;
    }
    invalid('has an invalid value token');
  }
  const result = value(0); whitespace();
  if (offset !== text.length) invalid('has trailing data');
  return result;
}
