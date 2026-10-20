// Shared helpers for the machine-collected facts layer (Node 22+, run with --experimental-strip-types).
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = dirname(fileURLToPath(import.meta.url))
export const BRIEFS_DIR = join(ROOT, '..', 'scene-factory', 'generated', 'briefs')
export const VENUES_JSON = join(ROOT, 'data', 'venues.json')
export const FACTS_DIR = join(ROOT, 'data', 'facts')
export const CACHE_DIR = join(ROOT, '.cache')

export const OSM_UA = 'allworld-places/0.1 (https://github.com/kromate/joinallworld)'

export type Venue = {
  city: string
  cityName: string
  venueId: string
  name: string
  kind: string
  variant: string | null
  disposition: 'target-recipe' | 'preserve-authored'
  lon: number | null
  lat: number | null
  placeholder: boolean
  country: string | null
  countryId: string | null
  region: string | null
  styleRegion: string | null
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function readJson<T = any>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function writeAtomic(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = path + '.tmp'
  writeFileSync(tmp, text)
  renameSync(tmp, path)
}

export function loadVenues(): Venue[] {
  return readJson<Venue[]>(VENUES_JSON)
}

export function venuesByCity(venues: Venue[]): Map<string, Venue[]> {
  const m = new Map<string, Venue[]>()
  for (const v of venues) {
    const a = m.get(v.city)
    if (a) a.push(v)
    else m.set(v.city, [v])
  }
  return m
}

/** Retrying fetch: backs off on 429/5xx and network errors. */
export async function fetchRetry(
  urls: string[],
  init: RequestInit,
  opts: { tries?: number; baseMs?: number; label?: string } = {},
): Promise<Response> {
  const tries = opts.tries ?? 6
  const base = opts.baseMs ?? 4000
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    const url = urls[i % urls.length]
    try {
      const res = await fetch(url!, init)
      if (res.ok) return res
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} from ${url}`)
        const ra = Number(res.headers.get('retry-after'))
        await sleep(Math.max(ra ? ra * 1000 : 0, base * 2 ** Math.min(i, 5)) + Math.random() * 1000)
        continue
      }
      throw new Error(`HTTP ${res.status} from ${url} (${opts.label ?? ''})`)
    } catch (e) {
      lastErr = e
      if (e instanceof Error && e.message.startsWith('HTTP 4')) throw e
      await sleep(base * 2 ** Math.min(i, 5) + Math.random() * 1000)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8
  const toR = Math.PI / 180
  const dLat = (lat2 - lat1) * toR
  const dLon = (lon2 - lon1) * toR
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// ---- name normalisation shared by OSM and Wikidata matching ----
const GENERIC = new Set(
  (
    'the of de da do del la le el al an a and for in at on game venue market park hotel mosque church cathedral school university college ' +
    'hospital clinic centre center central national international airport station terminal stadium museum library restaurant cafe bar club ' +
    'garden gardens square plaza hall house palace fort city town new old great grand royal st saint mount lake beach road street avenue ' +
    'bank office tower gate bus motor parish chapel temple shrine hostel resort mall complex shopping tourist amenities main general'
  ).split(' '),
)

export function normName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(game venue\)/g, ' ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function nameTokens(s: string): string[] {
  return normName(s)
    .split(' ')
    .filter((t) => t.length > 0)
}

/** 0 = no match; otherwise a score in (0,1]. Needs a distinctive (non-generic) shared token or an exact normalised match. */
export function nameScore(a: string, b: string): number {
  const na = normName(a)
  const nb = normName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = nameTokens(a)
  const tb = nameTokens(b)
  const sa = new Set(ta)
  const sb = new Set(tb)
  const shared = [...sa].filter((t) => sb.has(t))
  const distinct = shared.filter((t) => !GENERIC.has(t) && t.length > 2)
  if (distinct.length === 0) return 0
  const union = new Set([...sa, ...sb]).size
  const jac = shared.length / union
  const contained = shared.length === Math.min(sa.size, sb.size)
  if (contained && Math.min(sa.size, sb.size) >= 2) return Math.max(jac, 0.75)
  if (jac >= 0.5) return jac
  // a lone distinctive word fully contained in the other name (e.g. "Nike" in "Nike Art Gallery")
  if (contained && distinct[0]!.length >= 5) return 0.6
  return 0
}

/** Writes a facts file with one venue per line (compact, diff friendly). */
export function writeFacts(path: string, facts: { venues: Record<string, unknown> } & Record<string, unknown>) {
  const { venues, ...head } = facts
  const headText = JSON.stringify(head).slice(0, -1)
  const lines = Object.entries(venues).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
  writeAtomic(path, `${headText},"venues":{\n${lines.join(',\n')}\n}}\n`)
}
