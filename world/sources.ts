import { createHash } from 'node:crypto';
import type { SourceRecord } from './types.ts';

/** Pinned public source used only by the small Accra pilot. See pilots/README.md. */
export const ACCRA_OSM_SOURCE: SourceRecord = Object.freeze({
  id: 'osm-accra',
  url: 'file:world/pilots/accra.geojson',
  release: 'Derived GeoJSON pilot; converted 2026-10-08 from the OSM API extract at https://api.openstreetmap.org/api/0.6/map?bbox=-0.207,5.552,-0.203,5.556; raw XML SHA-256 12a4f458f03d7e696f3a67f53825e9b877c6a6ade43e8f1b4cacc259bf44b8e8 (607736 bytes)',
  license: 'ODbL-1.0',
  attribution: '© OpenStreetMap contributors',
  sha256: 'df6d5847c5d3f1528fa0e4f642257141eba785bc89a640a3f609b8fb970aadbc',
  bytes: 70637,
});

export const OVERTURE_ACQUISITION = Object.freeze({
  recipe: 'Resolve and record an explicit Overture release before acquisition. Query the buildings and transportation themes for the pinned release using bbox overlap: xmin <= east AND xmax >= west AND ymin <= north AND ymax >= south; then filter geometries against the requested region. Never use centroid-only selection. Split requests crossing the antimeridian and persist exact URLs, release, licence, SHA-256 and byte count.',
});

/** Fetch a caller-selected URL with hard byte and digest bounds; redirects are rejected. */
export async function fetchPinnedSource(url: string, maxBytes: number, expectedSha256: string, fetcher: typeof fetch = fetch, timeoutMs = 30_000): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError('maxBytes must be a positive safe integer');
  if (!/^https:\/\//.test(url)) throw new TypeError('source URL must use HTTPS');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new TypeError('expectedSha256 must be lowercase SHA-256');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new TypeError('timeoutMs must be between 1 and 30000');
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetcher(url, { redirect: 'error', signal });
  if (!response.ok) throw new Error(`source fetch failed: HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RangeError('source exceeds byte limit');
  if (!response.body) throw new Error('source response has no body');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new RangeError('source exceeds byte limit'); }
      chunks.push(part.value);
    }
  } catch (error) {
    try { await reader.cancel(error); } catch { /* Preserve the original read/timeout error. */ }
    if (signal.aborted) throw new Error(`source fetch exceeded ${timeoutMs} ms`, { cause: error });
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== expectedSha256) throw new Error(`source checksum mismatch: ${digest}`);
  return bytes;
}
