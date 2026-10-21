// Per-city Overpass fetch + venue->OSM element matching. Writes data/facts/<city>.json (wikidata filled by wikidata.ts).
// Usage: node --experimental-strip-types scripts/places/osm.ts [--city a,b] [--force] [--concurrency 2]
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CACHE_DIR, FACTS_DIR, OSM_UA, loadVenues, venuesByCity, sleep, writeAtomic, nameScore, type Venue,
} from './lib.ts'
import {
  assembleRings, centroid, distToPoly, minAreaRect, pointInPoly, pointToLocal, signedArea, simplifyRing, toLocal,
  type LL, type XY,
} from './geom.ts'

// overpass-api.de / kumi were unreachable (TCP timeouts) from the build machine, so mirrors follow; dead hosts are skipped for 10 min
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
const deadUntil = new Map<string, number>()
function pickEndpoint(i: number): string {
  const live = ENDPOINTS.filter((u) => (deadUntil.get(u) ?? 0) < Date.now())
  const pool = live.length ? live : ENDPOINTS
  return pool[i % pool.length]!
}
const RADIUS = 250
const NAME_MAX_M = 400
const NEAREST_MAX_M = 80
const OSM_CACHE = join(CACHE_DIR, 'osm')

const KEEP_TAGS = [
  'name', 'building', 'building:levels', 'height', 'roof:shape', 'roof:colour', 'roof:material', 'building:colour',
  'building:material', 'building:architecture', 'architect', 'start_date', 'wikidata', 'wikipedia', 'aeroway', 'amenity',
  'religion', 'denomination', 'leisure', 'tourism', 'historic',
]

type El = {
  type: 'way' | 'relation'
  id: number
  tags: Record<string, string>
  lat0: number
  lon0: number
  xy: XY[] // outer ring in local metres around (lat0,lon0), centred on centroid
  area: number
  bbox: [number, number, number, number]
  names: string[]
}

// ---------- Overpass ----------
function buildQuery(pts: { lat: number; lon: number; airport?: boolean }[]): string {
  const key = '[~"^(building|amenity|tourism|leisure|aeroway|man_made|historic)$"~"."]'
  const ways: string[] = []
  const rels: string[] = []
  for (const { lat, lon, airport } of pts) {
    const a = `(around:${RADIUS},${lat},${lon})`
    ways.push(`way${a}${key};`, `way${a}[railway=station];`)
    rels.push(`relation${a}[type=multipolygon]${key};`, `relation${a}[type=multipolygon][railway=station];`)
    if (airport) {
      // terminals anywhere on the aerodrome (the venue point may be far from the main terminal)
      const b = `(around:2500,${lat},${lon})`
      ways.push(`way${b}[aeroway=terminal];`, `way${b}[building=terminal];`)
      rels.push(`relation${b}[type=multipolygon][aeroway=terminal];`, `relation${b}[type=multipolygon][building=terminal];`)
    }
  }
  // relations need `body` so that member geometry is emitted
  return `[out:json][timeout:180];(${ways.join('')});out tags geom;(${rels.join('')});out body geom;`
}

let lastReq = 0
async function overpass(query: string, label: string): Promise<any> {
  let lastErr: unknown
  for (let i = 0; i < 10; i++) {
    const url = pickEndpoint(i)
    const wait = Math.max(0, lastReq + 1000 + Math.random() * 1000 - Date.now())
    lastReq = Date.now() + wait
    await sleep(wait)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': OSM_UA, accept: 'application/json' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(200000),
      })
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} ${url}`)
        await sleep(Math.min(120000, 5000 * 2 ** i) + Math.random() * 2000)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
      const text = await res.text()
      let json: any
      try {
        json = JSON.parse(text)
      } catch {
        lastErr = new Error(`non-JSON response from ${url}: ${text.slice(0, 120)}`)
        await sleep(Math.min(60000, 5000 * 2 ** i))
        continue
      }
      if (typeof json.remark === 'string' && /error|timed out|out of memory/i.test(json.remark)) {
        lastErr = new Error(`overpass remark: ${json.remark}`)
        await sleep(Math.min(120000, 8000 * 2 ** i))
        continue
      }
      return json
    } catch (e) {
      lastErr = e
      console.error(`[osm] ${label} attempt ${i + 1} failed on ${new URL(url).host}: ${(e as Error).message}`)
      if (/fetch failed|timeout|aborted/i.test((e as Error).message)) deadUntil.set(url, Date.now() + 10 * 60 * 1000)
      await sleep(Math.min(120000, 4000 * 2 ** i) + Math.random() * 2000)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function loadRaw(city: string, venues: Venue[]): Promise<any> {
  const path = join(OSM_CACHE, `${city}.json`)
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'))
  const pts = venues.filter((v) => v.lat != null && v.lon != null).map((v) => ({ lat: v.lat!, lon: v.lon!, airport: v.kind === 'airport' }))
  if (!pts.length) return { elements: [] }
  const merged = new Map<string, any>()
  for (let i = 0; i < pts.length; i += 60) {
    const json = await overpass(buildQuery(pts.slice(i, i + 60)), city)
    for (const e of json.elements ?? []) merged.set(`${e.type}/${e.id}`, e)
  }
  const out = { city, fetchedAt: new Date().toISOString(), elements: [...merged.values()] }
  mkdirSync(OSM_CACHE, { recursive: true })
  writeAtomic(path, JSON.stringify(out))
  return out
}

// ---------- element parsing ----------
const NAME_KEYS = /^(name(:.+)?|alt_name(:.+)?|official_name(:.+)?|short_name(:.+)?|old_name(:.+)?|loc_name|int_name)$/

function nameList(tags: Record<string, string>): string[] {
  const out = new Set<string>()
  for (const [k, v] of Object.entries(tags)) {
    if (NAME_KEYS.test(k)) for (const part of v.split(';')) if (part.trim()) out.add(part.trim())
  }
  return [...out]
}

function parseElement(raw: any): El | null {
  const tags: Record<string, string> = raw.tags ?? {}
  let outer: LL[] | null = null
  let holesArea = 0
  if (raw.type === 'way') {
    const g: LL[] | undefined = raw.geometry
    if (!g || g.length < 4) return null
    if (g[0]!.lat !== g[g.length - 1]!.lat || g[0]!.lon !== g[g.length - 1]!.lon) return null
    outer = g
  } else if (raw.type === 'relation') {
    const outers: LL[][] = []
    const inners: LL[][] = []
    for (const m of raw.members ?? []) {
      if (m.type !== 'way' || !m.geometry) continue
      if (m.role === 'inner') inners.push(m.geometry)
      else if (m.role === 'outer' || m.role === '') outers.push(m.geometry)
    }
    const rings = assembleRings(outers)
    if (!rings.length) return null
    const lat = rings[0]![0]!.lat
    const lon = rings[0]![0]!.lon
    let bestA = -1
    for (const r of rings) {
      const a = Math.abs(signedArea(toLocal(r, lat, lon)))
      if (a > bestA) {
        bestA = a
        outer = r
      }
    }
    if (!outer) return null
    const o = outer
    const olat = o[0]!.lat
    const olon = o[0]!.lon
    const op = toLocal(o, olat, olon)
    for (const r of assembleRings(inners)) {
      const ip = toLocal(r, olat, olon)
      if (pointInPoly(ip[0]![0], ip[0]![1], op)) holesArea += Math.abs(signedArea(ip))
    }
  }
  if (!outer) return null
  // drop the repeated closing vertex
  const ring = outer.slice(0, -1)
  const lat1 = ring[0]!.lat
  const lon1 = ring[0]!.lon
  const p1 = toLocal(ring, lat1, lon1)
  const area = Math.abs(signedArea(p1)) - holesArea
  const [cx, cy] = centroid(p1)
  // local frame centred on the centroid
  const k = Math.cos((lat1 * Math.PI) / 180)
  const lat0 = lat1 + (cy / 6371008.8) * (180 / Math.PI)
  const lon0 = lon1 + (cx / (6371008.8 * k)) * (180 / Math.PI)
  const xy = toLocal(ring, lat0, lon0)
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
  for (const [x, y] of xy) {
    if (x < minx) minx = x
    if (x > maxx) maxx = x
    if (y < miny) miny = y
    if (y > maxy) maxy = y
  }
  if (!(area > 1)) return null
  return { type: raw.type, id: raw.id, tags, lat0, lon0, xy, area, bbox: [minx, miny, maxx, maxy], names: nameList(tags) }
}

// ---------- matching ----------
const isBuilding = (e: El) => !!e.tags.building && e.tags.building !== 'no'
const isTerminal = (e: El) => e.tags.aeroway === 'terminal' || e.tags.building === 'terminal'
const isAerodrome = (e: El) => e.tags.aeroway === 'aerodrome'

type Probe = { el: El; px: number; py: number; dist: number; inside: boolean }

function probe(e: El, lat: number, lon: number): Probe | null {
  const [px, py] = pointToLocal(lat, lon, e.lat0, e.lon0)
  const [x0, y0, x1, y1] = e.bbox
  const dx = Math.max(x0 - px, 0, px - x1)
  const dy = Math.max(y0 - py, 0, py - y1)
  if (Math.hypot(dx, dy) > NAME_MAX_M) return null
  const dist = distToPoly(px, py, e.xy)
  return { el: e, px, py, dist, inside: dist === 0 }
}

type Match = { quality: 'name' | 'containing' | 'nearest' | 'none'; distanceM: number | null; nameScore?: number; el?: El; refined?: El; aerodrome?: El; otherTerms?: El[] }

function matchVenue(v: Venue, els: El[]): Match {
  if (v.lat == null || v.lon == null) return { quality: 'none', distanceM: null }
  const probes: Probe[] = []
  for (const e of els) {
    const p = probe(e, v.lat, v.lon)
    if (p) probes.push(p)
  }
  let chosen: Probe | null = null
  let quality: Match['quality'] = 'none'
  let ns = 0

  // 1. name match within 400 m
  if (!v.placeholder) {
    let bestKey = -Infinity
    for (const p of probes) {
      if (p.dist > NAME_MAX_M || !p.el.names.length) continue
      let s = 0
      for (const n of p.el.names) s = Math.max(s, nameScore(v.name, n))
      if (s <= 0) continue
      const key = s * 10 + (isBuilding(p.el) || isTerminal(p.el) || isAerodrome(p.el) ? 2 : 0) - p.dist / 400
      if (key > bestKey) {
        bestKey = key
        chosen = p
        ns = s
      }
    }
    if (chosen) quality = 'name'
  }
  // 2. containing: smallest building containing the point, else smallest other area (< 1 km2)
  if (!chosen) {
    let best: Probe | null = null
    for (const p of probes) if (p.inside && isBuilding(p.el) && (!best || p.el.area < best.el.area)) best = p
    if (!best) for (const p of probes) if (p.inside && !isAerodrome(p.el) && p.el.area < 1e6 && (!best || p.el.area < best.el.area)) best = p
    if (best) {
      chosen = best
      quality = 'containing'
    }
  }
  // 3. nearest building within 80 m
  if (!chosen) {
    let best: Probe | null = null
    for (const p of probes) if (isBuilding(p.el) && p.dist <= NEAREST_MAX_M && (!best || p.dist < best.dist)) best = p
    if (best) {
      chosen = best
      quality = 'nearest'
    }
  }

  // aerodromes: prefer the terminal building(s) inside the aerodrome polygon
  const isAirport = v.kind === 'airport'
  let aerodrome: El | undefined
  let otherTerms: El[] = []
  if (chosen && isAerodrome(chosen.el)) aerodrome = chosen.el
  if (!aerodrome && isAirport) {
    const a = probes.filter((p) => isAerodrome(p.el) && p.dist <= NAME_MAX_M).sort((a, b) => a.dist - b.dist)[0]
    if (a && (!chosen || !isTerminal(chosen.el))) aerodrome = a.el
  }
  if (aerodrome) {
    const inAero = (e: El) => {
      const [px, py] = pointToLocal(e.lat0, e.lon0, aerodrome!.lat0, aerodrome!.lon0)
      return pointInPoly(px, py, aerodrome!.xy)
    }
    const terms: Probe[] = []
    for (const e of els) {
      if (!isTerminal(e)) continue
      const [px, py] = pointToLocal(v.lat, v.lon, e.lat0, e.lon0)
      const dist = distToPoly(px, py, e.xy)
      if (inAero(e) || dist <= 250) terms.push({ el: e, px, py, dist, inside: dist === 0 })
    }
    terms.sort((a, b) => (isBuilding(b.el) ? 1 : 0) - (isBuilding(a.el) ? 1 : 0) || b.el.area - a.el.area)
    if (terms.length && (!chosen || isAerodrome(chosen.el) || isAirport)) {
      const t = terms[0]!
      otherTerms = terms.slice(1, 4).map((x) => x.el)
      // when the chosen match is a named non-aerodrome non-terminal element for an airport, keep it only if it is a building
      if (!chosen || isAerodrome(chosen.el) || !isBuilding(chosen.el)) {
        const q = (chosen?.el === aerodrome || quality === 'name' ? 'name' : quality === 'none' ? 'containing' : quality) as Match['quality'] | 'none'
        return { quality: q === 'none' ? 'containing' : q, distanceM: round1(t.dist), nameScore: ns || undefined, el: t.el, aerodrome, otherTerms }
      }
    }
    if (chosen && isAerodrome(chosen.el)) return { quality, distanceM: round1(chosen.dist), nameScore: ns || undefined, el: chosen.el, aerodrome }
  }
  if (!chosen) return { quality: 'none', distanceM: null }

  // a named non-building area (campus, hospital grounds...) with a building around the venue point: take that building's shape
  let refined: El | undefined
  if (!isBuilding(chosen.el) && !isAerodrome(chosen.el)) {
    let best: Probe | null = null
    for (const p of probes) {
      if (!p.inside || !isBuilding(p.el) || p.el === chosen.el) continue
      const [px, py] = pointToLocal(p.el.lat0, p.el.lon0, chosen.el.lat0, chosen.el.lon0)
      if (pointInPoly(px, py, chosen.el.xy) && (!best || p.el.area < best.el.area)) best = p
    }
    if (best) refined = best.el
  }
  return { quality, distanceM: round1(chosen.dist), nameScore: ns || undefined, el: chosen.el, refined, aerodrome }
}

// ---------- output ----------
const round1 = (n: number) => Math.round(n * 10) / 10

function keepTags(tags: Record<string, string>): Record<string, string> {
  const o: Record<string, string> = {}
  for (const k of KEEP_TAGS) if (tags[k] != null && tags[k] !== '') o[k] = tags[k]
  return o
}

function describe(m: Match) {
  const geomEl = m.refined ?? m.el!
  const tags = { ...keepTags(m.el!.tags), ...(m.refined ? keepTags(m.refined.tags) : {}) }
  if (m.refined && m.el!.tags.name) tags.name = m.el!.tags.name
  const ring = simplifyRing(geomEl.xy, 64).map(([x, y]) => [round1(x), round1(y)])
  const rect = minAreaRect(geomEl.xy)
  const o: any = {
    type: m.el!.type,
    id: m.el!.id,
    tags,
    centroid: [Math.round(geomEl.lon0 * 1e6) / 1e6, Math.round(geomEl.lat0 * 1e6) / 1e6],
    areaM2: Math.round(geomEl.area),
    widthM: round1(rect.w),
    depthM: round1(rect.d),
    bearingDeg: Math.round(rect.angle),
    footprint: ring,
  }
  if (m.refined) o.area = { type: m.el!.type, id: m.el!.id, areaM2: Math.round(m.el!.area) }
  if (m.refined) {
    o.type = m.refined.type
    o.id = m.refined.id
  }
  if (m.aerodrome && m.aerodrome !== m.el) o.aerodrome = { type: m.aerodrome.type, id: m.aerodrome.id, name: m.aerodrome.tags.name ?? null, iata: m.aerodrome.tags.iata ?? null }
  else if (m.aerodrome) o.aerodromeOnly = true
  if (m.otherTerms?.length) o.otherTerminals = m.otherTerms.map((e) => ({ type: e.type, id: e.id, name: e.tags.name ?? null, areaM2: Math.round(e.area) }))
  return o
}

async function processCity(city: string, venues: Venue[]) {
  const raw = await loadRaw(city, venues)
  const els: El[] = []
  for (const r of raw.elements ?? []) {
    const e = parseElement(r)
    if (e) els.push(e)
  }
  const out: Record<string, any> = {}
  for (const v of venues) {
    const m = matchVenue(v, els)
    const entry: any = { osm: m.el ? describe(m) : null, match: { quality: m.quality, distanceM: m.distanceM }, wikidata: null }
    if (m.nameScore) entry.match.nameScore = Math.round(m.nameScore * 100) / 100
    if (v.lat == null) entry.match.reason = 'no-position'
    out[v.venueId] = entry
  }
  const lines = Object.entries(out).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
  const text = `{"city":${JSON.stringify(city)},"generatedAt":${JSON.stringify(new Date().toISOString())},"osmElements":${els.length},"venues":{\n${lines.join(',\n')}\n}}\n`
  writeAtomic(join(FACTS_DIR, `${city}.json`), text)
  return { elements: els.length, quality: Object.values(out).reduce((a: any, v: any) => ((a[v.match.quality] = (a[v.match.quality] ?? 0) + 1), a), {}) }
}

// ---------- main ----------
const args = process.argv.slice(2)
const argVal = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const force = args.includes('--force')
const only = argVal('--city')?.split(',')
const concurrency = Number(argVal('--concurrency') ?? 2)

const byCity = venuesByCity(loadVenues())
const cities = [...byCity.keys()].filter((c) => !only || only.includes(c)).sort()
const todo = cities.filter((c) => force || !existsSync(join(FACTS_DIR, `${c}.json`)))
console.log(`[osm] ${cities.length} cities, ${todo.length} to do`)
mkdirSync(CACHE_DIR, { recursive: true })
const failLog = join(CACHE_DIR, 'osm-failures.log')
const t0 = Date.now()
let done = 0
const failed: string[] = []
let idx = 0
async function worker() {
  while (idx < todo.length) {
    const city = todo[idx++]
    try {
      const r = await processCity(city!, byCity.get(city!)!)
      done++
      console.log(`[osm] ${done}/${todo.length} ${city} els=${r.elements} ${JSON.stringify(r.quality)} t=${Math.round((Date.now() - t0) / 1000)}s`)
    } catch (e) {
      failed.push(city!)
      appendFileSync(failLog, `${new Date().toISOString()} ${city} ${(e as Error).message}\n`)
      console.error(`[osm] FAILED ${city}: ${(e as Error).message}`)
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker))
console.log(`[osm] finished in ${Math.round((Date.now() - t0) / 1000)}s; done=${done} failed=${failed.length} ${failed.join(',')}`)
