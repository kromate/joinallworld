// Enriches data/facts/<city>.json with Wikidata facts (OSM wikidata tag first, then name search + coordinate filter).
// Usage: node --experimental-strip-types scripts/places/wikidata.ts [--city a,b] [--force]
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CACHE_DIR, FACTS_DIR, OSM_UA, haversineM, loadVenues, normName, nameScore, readJson, sleep, venuesByCity, writeAtomic, writeFacts,
  type Venue,
} from './lib.ts'

const API = 'https://www.wikidata.org/w/api.php'
const UA = OSM_UA // "allworld-places/0.1 (https://github.com/kromate/joinallworld)"
const WD_CACHE = join(CACHE_DIR, 'wikidata')
const MAX_M = 2000

type Ent = {
  label: string | null
  description: string | null
  aliases: string[]
  coord: [number, number] | null // lat, lon
  p31: string[]
  p149: string[]
  p84: string[]
  year: number | null
  floors: number | null
  heightM: number | null
  widthM: number | null
  image: string | null
}

function loadMap<T>(name: string): Record<string, T> {
  const p = join(WD_CACHE, name)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
}
const searchCache = loadMap<string[]>('search.json')
const entCache = loadMap<Ent | null>('entities.json')
const labelCache = loadMap<string | null>('labels.json')
mkdirSync(WD_CACHE, { recursive: true })
const flush = () => {
  writeAtomic(join(WD_CACHE, 'search.json'), JSON.stringify(searchCache))
  writeAtomic(join(WD_CACHE, 'entities.json'), JSON.stringify(entCache))
  writeAtomic(join(WD_CACHE, 'labels.json'), JSON.stringify(labelCache))
}

let last = 0
async function api(params: Record<string, string>): Promise<any> {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`
  for (let i = 0; i < 8; i++) {
    const wait = Math.max(0, last + 350 - Date.now())
    last = Date.now() + wait
    await sleep(wait)
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(60000) })
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'))
        await sleep(Math.max(ra * 1000 || 0, 3000 * 2 ** Math.min(i, 5)))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = (await res.json()) as { error?: { code?: string } }
      if (j.error) {
        if (/maxlag|ratelimit|readonly/i.test(j.error.code ?? '')) { await sleep(5000 * 2 ** Math.min(i, 4)); continue }
        throw new Error(`api error ${j.error.code}`)
      }
      return j
    } catch (e) {
      if (i === 7) throw e
      console.error(`[wd] retry ${i + 1}: ${(e as Error).message}`)
      await sleep(3000 * 2 ** Math.min(i, 5))
    }
  }
}

const UNIT_M: Record<string, number> = { Q11573: 1, Q3710: 0.3048, Q174728: 0.01, Q828224: 1000, Q218593: 0.0254, Q253276: 1609.344 }

function claimValues(claims: any, pid: string): any[] {
  const list: any[] = claims?.[pid] ?? []
  const pref = list.filter((c) => c.rank === 'preferred')
  const use = pref.length ? pref : list.filter((c) => c.rank !== 'deprecated')
  return use.map((c) => c.mainsnak?.datavalue?.value).filter((v) => v != null)
}
const ids = (claims: any, pid: string): string[] => claimValues(claims, pid).map((v) => v?.id).filter(Boolean)
const quantity = (claims: any, pid: string, metres: boolean): number | null => {
  const v = claimValues(claims, pid)[0]
  if (!v || v.amount == null) return null
  let n = Number(v.amount)
  if (!Number.isFinite(n)) return null
  if (metres) {
    const unit = String(v.unit ?? '').split('/').pop() ?? ''
    if (unit in UNIT_M) n *= UNIT_M[unit]!
    else if (unit !== '' && unit !== '1') return null
    n = Math.round(n * 10) / 10
  }
  return n
}

function extract(e: any): Ent {
  const c = e.claims ?? {}
  const co = claimValues(c, 'P625')[0]
  const t = claimValues(c, 'P571')[0]
  const ym = typeof t?.time === 'string' ? /^([+-])(\d+)/.exec(t.time) : null
  const img = claimValues(c, 'P18')[0]
  return {
    label: e.labels?.en?.value ?? null,
    description: e.descriptions?.en?.value ?? null,
    aliases: (e.aliases?.en ?? []).map((a: any) => a.value).slice(0, 8),
    coord: co && typeof co.latitude === 'number' ? [co.latitude, co.longitude] : null,
    p31: ids(c, 'P31'),
    p149: ids(c, 'P149'),
    p84: ids(c, 'P84'),
    year: ym ? Number(ym[2]) * (ym[1] === '-' ? -1 : 1) : null,
    floors: quantity(c, 'P1101', false),
    heightM: quantity(c, 'P2048', true),
    widthM: quantity(c, 'P2049', true),
    image: typeof img === 'string' ? img : null,
  }
}

async function fetchEntities(qids: string[]) {
  const need = [...new Set(qids)].filter((q) => !(q in entCache))
  for (let i = 0; i < need.length; i += 50) {
    const batch = need.slice(i, i + 50)
    const j = await api({ action: 'wbgetentities', ids: batch.join('|'), props: 'labels|descriptions|aliases|claims', languages: 'en' })
    const seen = new Set<string>()
    for (const [k, e] of Object.entries<any>(j.entities ?? {})) {
      if (e.missing) { entCache[k] = null; seen.add(k); continue }
      const x = extract(e)
      entCache[k] = x
      seen.add(k)
      if (e.id && e.id !== k) { entCache[e.id] = x; seen.add(e.id) }
    }
    for (const q of batch) if (!seen.has(q)) entCache[q] = null
  }
}

async function fetchLabels(qids: string[]) {
  const need = [...new Set(qids)].filter((q) => !(q in labelCache))
  for (let i = 0; i < need.length; i += 50) {
    const batch = need.slice(i, i + 50)
    const j = await api({ action: 'wbgetentities', ids: batch.join('|'), props: 'labels', languages: 'en' })
    for (const q of batch) labelCache[q] = j.entities?.[q]?.labels?.en?.value ?? null
  }
}

async function search(name: string): Promise<string[]> {
  const key = normName(name)
  if (key in searchCache) return searchCache[key]!
  const j = await api({ action: 'wbsearchentities', search: name.replace(/\(game venue\)/i, '').trim(), language: 'en', uselang: 'en', type: 'item', limit: '5' })
  const out: string[] = (j.search ?? []).map((s: any) => s.id)
  searchCache[key] = out
  return out
}

function entityNames(e: Ent): string[] {
  return [e.label, ...e.aliases].filter((x): x is string => !!x)
}

function pick(v: Venue, qids: string[]): { q: string; dist: number | null; verified: boolean } | null {
  let best: { q: string; dist: number | null; verified: boolean; key: number } | null = null
  for (const q of qids) {
    const e = entCache[q]
    if (!e || e.p31.includes('Q5')) continue
    let s = 0
    for (const n of entityNames(e)) s = Math.max(s, nameScore(v.name, n))
    if (s <= 0) continue
    let dist: number | null = null
    let verified = false
    if (e.coord && v.lat != null && v.lon != null) {
      dist = haversineM(v.lat, v.lon, e.coord[0], e.coord[1])
      if (dist > MAX_M) continue
      verified = true
    } else {
      // no coordinate to check: only an exact label match that also names the city or country is trusted
      const exact = entityNames(e).some((n) => normName(n) === normName(v.name))
      const desc = (e.description ?? '').toLowerCase()
      const near = desc.includes(v.cityName.toLowerCase()) || (!!v.country && desc.includes(v.country.toLowerCase()))
      if (!exact || !near) continue
    }
    const key = s * 10 - (dist ?? 1500) / 1000
    if (!best || key > best.key) best = { q, dist, verified, key }
  }
  return best
}

function compose(q: string, via: 'osm-tag' | 'search', v: Venue, verified: boolean): any {
  const e = entCache[q]!
  const lab = (arr: string[]) => arr.map((x) => labelCache[x]).filter((x): x is string => !!x)
  const o: any = { id: q, via }
  if (e.label) o.label = e.label
  if (e.description) o.description = e.description
  const dist = e.coord && v.lat != null && v.lon != null ? Math.round(haversineM(v.lat, v.lon, e.coord[0], e.coord[1])) : null
  if (dist != null) o.distanceM = dist
  o.coordsVerified = verified || dist != null
  const inst = lab(e.p31)
  if (inst.length) o.instanceOf = inst
  const style = lab(e.p149)
  if (style.length) o.style = style
  const arch = lab(e.p84)
  if (arch.length) o.architect = arch
  if (e.year != null) o.inceptionYear = e.year
  if (e.floors != null) o.floors = e.floors
  if (e.heightM != null) o.heightM = e.heightM
  if (e.widthM != null) o.widthM = e.widthM
  if (e.image) o.image = e.image
  return o
}

async function processCity(city: string, venues: Venue[]) {
  const path = join(FACTS_DIR, `${city}.json`)
  const facts = readJson(path)
  const byId = new Map(venues.map((v) => [v.venueId, v]))
  const choice = new Map<string, { q: string; via: 'osm-tag' | 'search'; verified: boolean }>()
  const searchPending: Venue[] = []
  const tagQ: string[] = []
  for (const [vid, f] of Object.entries<any>(facts.venues)) {
    const v = byId.get(vid)
    if (!v) continue
    const tagged = f.osm?.tags?.wikidata
    if (typeof tagged === 'string' && /^Q\d+$/.test(tagged)) { tagQ.push(tagged); choice.set(vid, { q: tagged, via: 'osm-tag', verified: false }) }
    else if (!v.placeholder) searchPending.push(v)
  }
  const candidates = new Map<string, string[]>()
  for (const v of searchPending) candidates.set(v.venueId, await search(v.name))
  await fetchEntities([...tagQ, ...[...candidates.values()].flat()])
  for (const v of searchPending) {
    const p = pick(v, candidates.get(v.venueId)!)
    if (p) choice.set(v.venueId, { q: p.q, via: 'search', verified: p.verified })
  }
  // tagged but missing entity: fall back to search
  for (const [vid, c] of [...choice]) if (c.via === 'osm-tag' && !entCache[c.q]) choice.delete(vid)
  const labelIds: string[] = []
  for (const c of choice.values()) {
    const e = entCache[c.q]!
    labelIds.push(...e.p31, ...e.p149, ...e.p84)
  }
  await fetchLabels(labelIds)
  let n = 0
  for (const [vid, f] of Object.entries<any>(facts.venues)) {
    const c = choice.get(vid)
    f.wikidata = c ? compose(c.q, c.via, byId.get(vid)!, c.verified) : null
    if (c) n++
  }
  facts.wikidataDone = true
  writeFacts(path, facts)
  flush()
  return n
}

const args = process.argv.slice(2)
const argVal = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const force = args.includes('--force')
const only = argVal('--city')?.split(',')
const byCity = venuesByCity(loadVenues())
const t0 = Date.now()
let total = 0
let cityCount = 0
const failed: string[] = []
// loop so that cities finished by a concurrently running osm.ts get picked up
for (let round = 0; round < 1000; round++) {
  const todo = [...byCity.keys()].sort().filter((c) => (!only || only.includes(c)) && existsSync(join(FACTS_DIR, `${c}.json`)) && !failed.includes(c) && (force && round === 0 ? true : !readJson(join(FACTS_DIR, `${c}.json`)).wikidataDone))
  if (!todo.length) {
    const missing = [...byCity.keys()].filter((c) => (!only || only.includes(c)) && !existsSync(join(FACTS_DIR, `${c}.json`)))
    if (!missing.length || args.includes('--no-wait')) break
    console.log(`[wd] waiting for osm facts of ${missing.length} cities`)
    await sleep(60000)
    continue
  }
  for (const c of todo) {
    try {
      const n = await processCity(c, byCity.get(c)!)
      total += n
      cityCount++
      console.log(`[wd] ${cityCount} ${c} wikidata=${n}/${byCity.get(c)!.length} t=${Math.round((Date.now() - t0) / 1000)}s`)
    } catch (e) {
      failed.push(c)
      console.error(`[wd] FAILED ${c}: ${(e as Error).message}`)
    }
  }
  if (force) break
}
flush()
console.log(`[wd] finished in ${Math.round((Date.now() - t0) / 1000)}s cities=${cityCount} withWikidata=${total} failed=${failed.join(',')}`)
