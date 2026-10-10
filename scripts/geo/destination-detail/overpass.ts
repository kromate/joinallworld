/**
 * The one polite way the destination-detail builders ask the public Overpass interpreter for data: one request at a time, a
 * pause between requests, a small retry allowance, a hard cap on response size, and every answer kept in a cache directory
 * outside the repository so a rebuild asks again only for what it has never fetched.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const MAX_BYTES = 12 * 1024 * 1024;
const PAUSE_MS = 30_000;
const ATTEMPTS = 6;

export interface Answer { raw: string; sha256: string; elements: Element[] }
export interface Element {
  type: 'node' | 'way' | 'relation'; id: number; tags?: Record<string, string>
  lat?: number; lon?: number; center?: { lat: number; lon: number }
  geometry?: { lat: number; lon: number }[]
  members?: { type: 'node' | 'way' | 'relation'; ref: number; role: string; geometry?: { lat: number; lon: number }[] }[]
}

export function cacheDir(city: string): string {
  const root = process.env.ALLWORLD_GEO_CACHE ?? new URL('../../../.cache/geo', import.meta.url).pathname;
  const dir = join(root, 'destination-detail', city);
  mkdirSync(dir, { recursive: true });
  return dir;
}

let lastRequest = 0;
export async function ask(city: string, label: string, query: string): Promise<Answer> {
  // The query is part of the file name, so an edited query never reads an answer given to another.
  const file = join(cacheDir(city), `${label}-${createHash('sha256').update(query).digest('hex').slice(0, 10)}.json`);
  if (existsSync(file)) return parse(readFileSync(file, 'utf8'));
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const wait = lastRequest + PAUSE_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest = Date.now();
    const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'User-Agent': 'allworld-geo-build', 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}` });
    const raw = await response.text();
    if (response.ok && raw.trimStart().startsWith('{')) {
      if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error(`${label}: answer is over ${MAX_BYTES} bytes`);
      writeFileSync(file, raw);
      return parse(raw);
    }
    console.error(`${label}: attempt ${attempt} answered ${response.status}`);
    lastRequest = Date.now() + PAUSE_MS * attempt * 2;
  }
  throw new Error(`${label}: Overpass kept refusing the request`);
}

function parse(raw: string): Answer {
  return { raw, sha256: createHash('sha256').update(raw).digest('hex'), elements: (JSON.parse(raw) as { elements: Element[] }).elements };
}
