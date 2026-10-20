// Photo evidence per venue: candidate real photos (metadata + URLs only) from Wikidata, Commons and Wikipedia.
// Usage: node --experimental-strip-types scripts/places/evidence.ts [--city a,b] [--no-geo] [--offline]
// Output: scripts/places/data/evidence/<city>.json. Raw API responses are cached (append-only JSONL) in .cache/evidence/.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE_DIR, FACTS_DIR, OSM_UA, loadVenues, readJson, sleep, venuesByCity, writeAtomic } from './lib.ts'

const CACHE = join(CACHE_DIR, 'evidence')
const OUT_DIR = join(FACTS_DIR, '..', 'evidence')
mkdirSync(CACHE, { recursive: true })
mkdirSync(OUT_DIR, { recursive: true })

const args = process.argv.slice(2)
const onlyCities = (() => {
  const i = args.indexOf('--city')
  return i >= 0 ? new Set(args[i + 1]!.split(',')) : null
})()
const NO_GEO = args.includes('--no-geo')
const OFFLINE = args.includes('--offline')

// ---------- JSONL caches ----------
class Cache<T> {
  m = new Map<string, T>()
  path: string
  constructor(name: string) {
    this.path = join(CACHE, name + '.jsonl')
    if (existsSync(this.path)) {
      for (const line of readFileSync(this.path, 'utf8').split('\n')) {
        if (!line) continue
        try {
          const [k, v] = JSON.parse(line)
          this.m.set(k, v)
        } catch {
          /* torn last line */
        }
      }
    }
  }
  has(k: string) {
    return this.m.has(k)
  }
  get(k: string) {
    return this.m.get(k)
  }
  set(k: string, v: T) {
    this.m.set(k, v)
    appendFileSync(this.path, JSON.stringify([k, v]) + '\n')
  }
}

// ---------- polite API client ----------
const MAX_INFLIGHT = 3
let inflight = 0
let lastStart = 0
const waiters: Array<() => void> = []
let requests = 0
async function acquire() {
  while (inflight >= MAX_INFLIGHT) await new Promise<void>((r) => waiters.push(r))
  inflight++
  const wait = Math.max(0, lastStart + 120 - Date.now())
  lastStart = Date.now() + wait
  if (wait) await sleep(wait)
}
function release() {
  inflight--
  waiters.shift()?.()
}

async function api(host: string, params: Record<string, string>): Promise<any> {
  if (OFFLINE) throw new Error('offline')
  const url = `https://${host}/w/api.php`
  const body = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString()
  let lastErr: unknown
  for (let i = 0; i < 7; i++) {
    let backoff = 0
    await acquire()
    try {
      requests++
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'user-agent': OSM_UA, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(60000),
      })
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get('retry-after'))
        backoff = Math.max(ra * 1000 || 0, 3000 * 2 ** Math.min(i, 5))
        lastErr = new Error(`HTTP ${res.status}`)
      } else if (!res.ok) {
        throw Object.assign(new Error(`HTTP ${res.status} ${host}`), { fatal: true })
      } else {
        const j = (await res.json()) as { error?: { code?: string; info?: string } }
        if (!j.error) return j
        if (/maxlag|ratelimit|readonly|internal|busy/i.test(j.error.code ?? '')) {
          backoff = 5000 * 2 ** Math.min(i, 4)
          lastErr = new Error('api error ' + j.error.code)
        } else throw Object.assign(new Error(`api error ${j.error.code}: ${j.error.info}`), { fatal: true })
      }
    } catch (e) {
      if ((e as any).fatal) throw e
      lastErr = e
      backoff = 3000 * 2 ** Math.min(i, 5)
    } finally {
      release()
    }
    await sleep(backoff + Math.random() * 500)
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function runPool<T>(items: T[], label: string, fn: (item: T) => Promise<void>) {
  let idx = 0
  let done = 0
  const total = items.length
  const t0 = Date.now()
  const worker = async () => {
    while (idx < total) {
      const it = items[idx++]
      try {
        await fn(it as T)
      } catch (e) {
        console.error(`[${label}] failed: ${(e as Error).message}`)
      }
      done++
      if (done % 50 === 0 || done === total) {
        console.log(`[${label}] ${done}/${total} (${Math.round((Date.now() - t0) / 1000)}s, ${requests} req total)`)
      }
    }
  }
  await Promise.all(Array.from({ length: MAX_INFLIGHT }, worker))
}

const chunk = <T>(a: T[], n: number): T[][] => {
  const o: T[][] = []
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n))
  return o
}

// ---------- types ----------
type Info = { t: string; w: number; h: number; thumb: string; lic: string; artist: string; page: string; mime: string }
type Ent = { p18: string[]; p373: string[]; p8592: string[]; p3451: string[]; commonsCat: string | null; wikis: Record<string, string> }
type WpRec = { pi: string | null; images: string[] }
type GeoHit = { t: string; d: number }

const entCache = new Cache<Ent | null>('entities')
const iiCache = new Cache<Info | null>('imageinfo')
const catCache = new Cache<string[]>('catmembers')
const wpCache = new Cache<WpRec | null>('wikipedia')
const geoCache = new Cache<GeoHit[]>('geo')

// ---------- filters ----------
const normFile = (s: string) => {
  let t = s.replace(/^(File|Image|Fichier|Archivo|Datei):/i, '').replace(/_/g, ' ').trim()
  t = t.charAt(0).toUpperCase() + t.slice(1)
  return 'File:' + t
}
const EXT_OK = /\.(jpe?g|png|webp)$/i
const SKIP_TITLE =
  /\b(map|maps|plan|plans|logo|logos|coat[ _-]of[ _-]arms|coa|flag|flags|seal|emblem|signature|locator|location|diagram|blason|wappen|escudo|banner|icon|stamp|poster|screenshot|chart|graph|sketch|drawing|floorplan|floor[ _-]plan|schematic|route|stub|symbol|badge|crest|wordmark|commons-logo|qr|cover|scan|cartoon|painting|postcard|ticket|menu|portrait|headshot|autograph|crop(ped)?[ _-]?face)\b|\bmap\b|(^|[ _-])(pdf|svg)$/i
const DOWN_TITLE: Array<[RegExp, number, string]> = [
  [/\b(interior|interiors|inside|indoor|altar|nave|lobby|hallway|corridor|room|ceiling|staircase)\b/i, -30, 'interior?'],
  [/\b(night|nighttime|at night|evening|illuminated|lit up|floodlit|dusk)\b/i, -25, 'night'],
  [/\b(detail|details|close-?up|sign|signage|plaque|inscription|statue|bust|monument inscription)\b/i, -12, 'detail'],
  [/\b(aerial|drone|satellite)\b/i, 0, 'aerial'],
]

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
const titleOk = (t: string) => EXT_OK.test(t) && !SKIP_TITLE.test(norm(t).replace(/\.[a-z]+$/, ''))

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)

// ---------- imageinfo ----------
const II_PROPS = {
  prop: 'imageinfo',
  iiprop: 'url|size|mime|extmetadata',
  iiurlwidth: '800',
  iiextmetadatafilter: 'LicenseShortName|Artist|NonFree|Restrictions',
}
function ingestPage(p: any): [string, Info | null] | null {
  const ii = p.imageinfo?.[0]
  if (p.missing || !ii) return [p.title, null]
  const em = ii.extmetadata ?? {}
  const lic = String(em.LicenseShortName?.value ?? '')
  const nonFree = em.NonFree?.value
  if (nonFree === 'true' || /fair use/i.test(lic)) return [p.title, null]
  return [
    p.title,
    {
      t: p.title,
      w: ii.width ?? 0,
      h: ii.height ?? 0,
      thumb: String(ii.thumburl ?? ii.url).replace(/\?utm_[^ ]*$/, ''),
      lic: lic || 'unknown',
      artist: stripHtml(String(em.Artist?.value ?? '')),
      page: ii.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
      mime: ii.mime ?? '',
    },
  ]
}

async function fetchImageInfo(titles: string[]) {
  const need = [...new Set(titles.map(normFile))].filter((t) => !iiCache.has(t))
  await runPool(chunk(need, 50), 'imageinfo', async (batch) => {
    const j = await api('commons.wikimedia.org', { action: 'query', titles: batch.join('|'), redirects: '1', ...II_PROPS })
    const redirFrom = new Map<string, string>() // target -> original(s)
    const redirs: Array<{ from: string; to: string }> = j.query?.redirects ?? []
    const seen = new Set<string>()
    for (const p of j.query?.pages ?? []) {
      const r = ingestPage(p)
      if (!r) continue
      seen.add(r[0])
      iiCache.set(r[0], r[1])
    }
    for (const r of redirs) {
      redirFrom.set(r.from, r.to)
      const v = iiCache.get(r.to)
      if (v !== undefined) iiCache.set(r.from, v)
    }
    for (const t of batch) if (!iiCache.has(t)) iiCache.set(t, null)
  })
}

// ---------- venue context ----------
type Ctx = {
  id: string
  city: string
  name: string
  lat: number | null
  lon: number | null
  qid: string | null
  p18: string | null
  osmWiki: { lang: string; title: string } | null
  osmCommons: string | null
  country: string
}

const COUNTRY_LANG: Record<string, string> = {
  // ISO-ish country ids used in venues.json -> likely local Wikipedia language
  ad: 'ca', ae: 'ar', af: 'fa', ao: 'pt', ar: 'es', at: 'de', az: 'az', ba: 'bs', bd: 'bn', be: 'nl', bf: 'fr', bg: 'bg', bh: 'ar', bi: 'fr', bj: 'fr',
  bl: 'fr', bo: 'es', br: 'pt', by: 'be', cd: 'fr', cf: 'fr', cg: 'fr', ch: 'de', ci: 'fr', cl: 'es', cm: 'fr', cn: 'zh', co: 'es', cr: 'es', cu: 'es',
  cv: 'pt', cz: 'cs', de: 'de', dj: 'fr', dk: 'da', do: 'es', dz: 'fr', ec: 'es', ee: 'et', eg: 'ar', eh: 'ar', er: 'ar', es: 'es', fi: 'fi', fo: 'fo',
  fr: 'fr', ga: 'fr', ge: 'ka', gl: 'da', gn: 'fr', gq: 'es', gr: 'el', gt: 'es', gw: 'pt', hk: 'zh', hn: 'es', hr: 'hr', ht: 'fr', hu: 'hu', id: 'id',
  il: 'he', in: 'hi', iq: 'ar', ir: 'fa', is: 'is', it: 'it', jo: 'ar', jp: 'ja', kg: 'ru', kh: 'km', km: 'fr', kp: 'ko', kr: 'ko', kw: 'ar', kz: 'ru',
  la: 'lo', lb: 'ar', lt: 'lt', lu: 'fr', lv: 'lv', ly: 'ar', ma: 'ar', mc: 'fr', md: 'ro', me: 'sr', mf: 'fr', mg: 'fr', mk: 'mk', ml: 'fr', mm: 'my',
  mn: 'mn', mo: 'zh', mr: 'ar', mx: 'es', my: 'ms', mz: 'pt', nc: 'fr', ne: 'fr', ni: 'es', nl: 'nl', no: 'no', np: 'ne', om: 'ar', pa: 'es', pe: 'es',
  pf: 'fr', ph: 'tl', pk: 'ur', pl: 'pl', pm: 'fr', pr: 'es', ps: 'ar', pt: 'pt', py: 'es', qa: 'ar', ro: 'ro', rs: 'sr', ru: 'ru', rw: 'fr', sa: 'ar',
  sd: 'ar', se: 'sv', si: 'sl', sk: 'sk', sm: 'it', sn: 'fr', so: 'so', sr: 'nl', st: 'pt', sv: 'es', sy: 'ar', td: 'fr', tg: 'fr', th: 'th', tj: 'tg',
  tl: 'pt', tm: 'tk', tn: 'ar', tr: 'tr', tw: 'zh', tz: 'sw', ua: 'uk', uy: 'es', uz: 'uz', va: 'it', ve: 'es', vn: 'vi', wf: 'fr', ye: 'ar', ke: 'sw',
  ng: 'yo', nigeria: 'yo',
}

function loadCtx(): Ctx[] {
  const venues = loadVenues()
  const byCity = venuesByCity(venues)
  const out: Ctx[] = []
  for (const [city, vs] of byCity) {
    if (onlyCities && !onlyCities.has(city)) continue
    const fp = join(FACTS_DIR, city + '.json')
    const facts = existsSync(fp) ? readJson<any>(fp).venues : {}
    for (const v of vs) {
      const f = facts[v.venueId]
      const wd = f?.wikidata
      const tags = f?.osm?.tags ?? {}
      const q = f?.match?.quality
      const goodMatch = q === 'name' || q === 'containing' || (wd && tags.wikidata === wd.id)
      let osmWiki: Ctx['osmWiki'] = null
      if (goodMatch && typeof tags.wikipedia === 'string' && tags.wikipedia.includes(':')) {
        const [lang, ...rest] = tags.wikipedia.split(':')
        if (/^[a-z-]{2,12}$/.test(lang)) osmWiki = { lang, title: rest.join(':') }
      }
      out.push({
        id: v.venueId,
        city,
        name: v.name,
        lat: v.lat,
        lon: v.lon,
        qid: wd?.id ?? null,
        p18: wd?.image ?? null,
        osmWiki,
        osmCommons: goodMatch && typeof tags.wikimedia_commons === 'string' ? tags.wikimedia_commons : null,
        country: v.countryId ?? '',
      })
    }
  }
  return out
}

// ---------- phase: wikidata entities ----------
const claimIds = (claims: any, pid: string): string[] => {
  const list: any[] = claims?.[pid] ?? []
  const pref = list.filter((c) => c.rank === 'preferred')
  const use = pref.length ? pref : list.filter((c) => c.rank !== 'deprecated')
  return use.map((c) => c.mainsnak?.datavalue?.value).filter((v) => typeof v === 'string')
}

async function fetchEntities(ctx: Ctx[]) {
  const need = [...new Set(ctx.map((c) => c.qid).filter((q): q is string => !!q))].filter((q) => !entCache.has(q))
  await runPool(chunk(need, 50), 'entities', async (batch) => {
    const j = await api('www.wikidata.org', { action: 'wbgetentities', ids: batch.join('|'), props: 'claims|sitelinks' })
    for (const id of batch) {
      const e = j.entities?.[id]
      if (!e || e.missing !== undefined) {
        entCache.set(id, null)
        continue
      }
      const wikis: Record<string, string> = {}
      for (const [site, sl] of Object.entries<any>(e.sitelinks ?? {})) {
        const m = /^([a-z_]+)wiki$/.exec(site)
        if (m && !['commons', 'species', 'meta', 'wikidata', 'simple'].includes(m[1]!)) wikis[m[1]!.replace(/_/g, '-')] = sl.title
      }
      const cc = e.sitelinks?.commonswiki?.title as string | undefined
      entCache.set(id, {
        p18: claimIds(e.claims, 'P18').slice(0, 3),
        p373: claimIds(e.claims, 'P373').slice(0, 2),
        p8592: claimIds(e.claims, 'P8592').slice(0, 2),
        p3451: claimIds(e.claims, 'P3451').slice(0, 2),
        commonsCat: cc && cc.startsWith('Category:') ? cc : null,
        wikis,
      })
    }
  })
}

// ---------- wikipedia targets ----------
const LANG_PRIORITY = ['fr', 'es', 'pt', 'de', 'ar', 'ru', 'it', 'nl', 'zh', 'ja']
function wikiTargets(c: Ctx): Array<{ lang: string; title: string }> {
  const ent = c.qid ? entCache.get(c.qid) : null
  const out: Array<{ lang: string; title: string }> = []
  const add = (lang: string, title: string | undefined) => {
    if (title && !out.some((o) => o.lang === lang)) out.push({ lang, title })
  }
  if (c.osmWiki) add(c.osmWiki.lang, c.osmWiki.title)
  const w = ent?.wikis ?? {}
  add('en', w.en)
  const local = COUNTRY_LANG[c.country.toLowerCase()]
  if (local && local !== 'en') add(local, w[local])
  if (out.length === 0) for (const l of LANG_PRIORITY) if (w[l]) { add(l, w[l]); break }
  if (out.length === 0) {
    const k = Object.keys(w)[0]
    if (k) add(k, w[k])
  }
  return out.slice(0, 2)
}
const wpKey = (lang: string, title: string) => `${lang}:${title.replace(/_/g, ' ')}`

async function fetchWikipedia(ctx: Ctx[]) {
  const byLang = new Map<string, Set<string>>()
  for (const c of ctx)
    for (const t of wikiTargets(c)) {
      const k = wpKey(t.lang, t.title)
      if (wpCache.has(k)) continue
      if (!byLang.has(t.lang)) byLang.set(t.lang, new Set())
      byLang.get(t.lang)!.add(t.title.replace(/_/g, ' '))
    }
  const jobs: Array<{ lang: string; titles: string[] }> = []
  for (const [lang, set] of byLang) for (const b of chunk([...set], 10)) jobs.push({ lang, titles: b })
  await runPool(jobs, 'wikipedia', async ({ lang, titles }) => {
    const host = `${lang.replace(/_/g, '-')}.wikipedia.org`
    const res = new Map<string, WpRec>()
    const aliases = new Map<string, string>() // normalized/redirect -> requested
    const requested = new Set(titles)
    // pageimages (lead image) + image list with continuation
    const base: Record<string, string> = { action: 'query', titles: titles.join('|'), redirects: '1', prop: 'pageimages|images', piprop: 'name', imlimit: 'max' }
    let cont: Record<string, string> = {}
    for (let guard = 0; guard < 12; guard++) {
      const j = await api(host, { ...base, ...cont })
      for (const n of j.query?.normalized ?? []) aliases.set(n.to, n.from)
      for (const r of j.query?.redirects ?? []) aliases.set(r.to, aliases.get(r.from) ?? r.from)
      for (const p of j.query?.pages ?? []) {
        const rec = res.get(p.title) ?? { pi: null, images: [] }
        if (p.pageimage) rec.pi = 'File:' + String(p.pageimage).replace(/_/g, ' ')
        for (const im of p.images ?? []) rec.images.push(im.title)
        if (!p.missing) res.set(p.title, rec)
        else res.set(p.title, { pi: null, images: [] })
      }
      if (!j.continue) break
      cont = j.continue
    }
    for (const t of requested) {
      let rec = res.get(t)
      if (!rec) for (const [to, from] of aliases) if (from === t && res.has(to)) rec = res.get(to)
      wpCache.set(wpKey(lang, t), rec ?? null)
    }
  })
}

// ---------- commons categories ----------
const catName = (s: string) => 'Category:' + s.replace(/^Category:/i, '').replace(/_/g, ' ').trim()
function categoriesFor(c: Ctx): string[] {
  const ent = c.qid ? entCache.get(c.qid) : null
  const out: string[] = []
  for (const x of ent?.p373 ?? []) out.push(catName(x))
  if (ent?.commonsCat) out.push(catName(ent.commonsCat))
  if (c.osmCommons && /^Category:/i.test(c.osmCommons)) out.push(catName(c.osmCommons))
  return [...new Set(out)].slice(0, 2)
}

async function fetchCategories(ctx: Ctx[]) {
  const need = [...new Set(ctx.flatMap(categoriesFor))].filter((c) => !catCache.has(c))
  await runPool(need, 'categories', async (cat) => {
    const j = await api('commons.wikimedia.org', {
      action: 'query',
      generator: 'categorymembers',
      gcmtitle: cat,
      gcmtype: 'file',
      gcmlimit: '40',
      ...II_PROPS,
    })
    const titles: string[] = []
    for (const p of j.query?.pages ?? []) {
      const r = ingestPage(p)
      if (!r) continue
      iiCache.set(r[0], r[1])
      titles.push(r[0])
    }
    catCache.set(cat, titles)
  })
}

// ---------- geosearch ----------
const geoKey = (id: string, r: number) => `${id}@${r}`
const GEO_R = 250
async function fetchGeo(todo: Ctx[]) {
  const need = todo.filter((c) => c.lat != null && c.lon != null && !geoCache.has(geoKey(c.id, GEO_R)))
  await runPool(need, 'geo', async (c) => {
    const j = await api('commons.wikimedia.org', {
      action: 'query',
      list: 'geosearch',
      gscoord: `${c.lat}|${c.lon}`,
      gsradius: String(GEO_R),
      gsnamespace: '6',
      gslimit: '40',
      gsprimary: 'all',
    })
    const hits: GeoHit[] = (j.query?.geosearch ?? []).map((g: any) => ({ t: g.title, d: Math.round(g.dist) }))
    geoCache.set(geoKey(c.id, GEO_R), hits)
  })
}

// ---------- compose ----------
type Photo = {
  file: string
  page: string
  thumb800: string
  width: number
  height: number
  licence: string
  artist: string
  source: 'p18' | 'category' | 'wikipedia' | 'geo'
  distanceM?: number
  note?: string
}
type Cand = Photo & { score: number }

const STOP = new Set('the and for with from city town new old great national international central main north south east west park hotel market church mosque school university college hospital stadium museum station airport centre center'.split(' '))
function nameTokens(name: string): string[] {
  return norm(name).split(/[^a-z0-9]+/).filter((t) => t.length > 3 && !STOP.has(t))
}
function mk(info: Info, source: Photo['source'], base: number, extra: { note?: string[]; distanceM?: number; name?: string; lead?: boolean } = {}): Cand | null {
  if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime) || !titleOk(info.t)) return null
  if (info.w < 500) return null
  let score = base
  const notes = [...(extra.note ?? [])]
  const low = norm(info.t)
  for (const [re, pen, tag] of DOWN_TITLE) if (re.test(low)) { score += pen; if (!notes.includes(tag)) notes.push(tag) }
  if (extra.name && source !== 'p18') {
    const toks = nameTokens(extra.name)
    if (toks.length && toks.some((t) => low.includes(t))) score += 15
  }
  if (source === 'wikipedia' && !extra.lead && /\.png$/i.test(info.t)) score -= 15
  const yr = /\b(1[0-8]\d\d|19[0-4]\d)\b/.exec(low)
  if (yr) { score -= 10; notes.push('historic?') }
  if (info.w >= 800) score += 10
  if (info.w >= 1600) score += 3
  if (info.w > info.h) score += 8
  else if (info.h > info.w * 1.4) score -= 8
  if (info.w * info.h < 400 * 400) score -= 10
  const p: Cand = {
    file: info.t.replace(/^File:/, ''),
    page: info.page,
    thumb800: info.thumb,
    width: info.w,
    height: info.h,
    licence: info.lic,
    artist: info.artist,
    source,
    score,
  }
  if (extra.distanceM != null) p.distanceM = extra.distanceM
  if (notes.length) p.note = notes.join(', ')
  return p
}

function candidates(c: Ctx, withGeo: boolean): Cand[] {
  const ent = c.qid ? entCache.get(c.qid) : null
  const cs = new Map<string, Cand>()
  const put = (p: Cand | null) => {
    if (!p) return
    const prev = cs.get(p.file)
    if (!prev || prev.score < p.score) cs.set(p.file, p)
  }
  const ii = (t: string) => iiCache.get(normFile(t)) ?? null
  const p18s = [...new Set([...(c.p18 ? [c.p18] : []), ...(ent?.p18 ?? [])])]
  p18s.slice(0, 3).forEach((f, i) => put(mk(ii(f)!, 'p18', 100 - i * 4)))
  for (const f of ent?.p8592 ?? []) put(mk(ii(f)!, 'p18', 82, { note: ['aerial'] }))
  for (const f of ent?.p3451 ?? []) put(mk(ii(f)!, 'p18', 80, { note: ['night'] }))
  for (const cat of categoriesFor(c)) {
    const members = catCache.get(cat) ?? []
    members.forEach((t) => put(mk(ii(t)!, 'category', 68, { name: c.name })))
  }
  for (const t of wikiTargets(c)) {
    const rec = wpCache.get(wpKey(t.lang, t.title))
    if (!rec) continue
    if (rec.pi) put(mk(ii(rec.pi)!, 'wikipedia', 62, { note: [`${t.lang}wiki lead`], lead: true, name: c.name }))
    let n = 0
    for (const im of rec.images) {
      if (n >= 10) break
      const inf = ii(im)
      const p = inf ? mk(inf, 'wikipedia', 50, { note: [`${t.lang}wiki`], name: c.name }) : null
      if (p) { put(p); n++ }
    }
  }
  if (withGeo) {
    for (const h of geoCache.get(geoKey(c.id, GEO_R)) ?? []) {
      const inf = ii(h.t)
      const p = inf ? mk(inf, 'geo', 30 - h.d / 12, { distanceM: h.d, note: ['street photo near place'], name: c.name }) : null
      put(p)
    }
  }
  return [...cs.values()].sort((a, b) => b.score - a.score)
}

function pick(list: Cand[]): Cand[] {
  // cap noisy sources so one category cannot crowd out everything
  const cap: Record<string, number> = { p18: 4, category: 5, wikipedia: 4, geo: 6 }
  const used: Record<string, number> = {}
  const out: Cand[] = []
  for (const p of list) {
    if ((used[p.source] ?? 0) >= cap[p.source]!) continue
    used[p.source] = (used[p.source] ?? 0) + 1
    out.push(p)
    if (out.length === 8) break
  }
  return out
}

// ---------- main ----------
const t0 = Date.now()
const ctx = loadCtx()
console.log(`venues: ${ctx.length}, with wikidata: ${ctx.filter((c) => c.qid).length}`)

await fetchEntities(ctx)
await fetchWikipedia(ctx)
await fetchCategories(ctx)

// imageinfo for every directly referenced file
{
  const files = new Set<string>()
  for (const c of ctx) {
    const ent = c.qid ? entCache.get(c.qid) : null
    if (c.p18) files.add(c.p18)
    for (const f of [...(ent?.p18 ?? []), ...(ent?.p8592 ?? []), ...(ent?.p3451 ?? [])]) files.add(f)
    for (const t of wikiTargets(c)) {
      const rec = wpCache.get(wpKey(t.lang, t.title))
      if (!rec) continue
      if (rec.pi) files.add(rec.pi)
      // pre-filter by title to avoid fetching icons
      let n = 0
      for (const im of rec.images) if (titleOk(im) && n++ < 40) files.add(im)
    }
  }
  console.log(`imageinfo candidates: ${files.size}`)
  await fetchImageInfo([...files])
}

if (!NO_GEO) {
  const todo = ctx.filter((c) => pick(candidates(c, false)).length < 2)
  console.log(`geosearch for ${todo.length} venues with <2 photos`)
  await fetchGeo(todo)
  const files = new Set<string>()
  for (const c of todo) for (const h of geoCache.get(geoKey(c.id, GEO_R)) ?? []) if (titleOk(h.t)) files.add(h.t)
  console.log(`geo imageinfo: ${files.size}`)
  await fetchImageInfo([...files])
}

// write outputs
const stats = {
  venues: 0, ge1: 0, ge3: 0,
  bySourceVenues: { p18: 0, category: 0, wikipedia: 0, geo: 0 } as Record<string, number>,
  byCity: {} as Record<string, { n: number; ge1: number; ge3: number }>,
}
const byCity = new Map<string, Ctx[]>()
for (const c of ctx) (byCity.get(c.city) ?? byCity.set(c.city, []).get(c.city)!).push(c)
const generatedAt = new Date().toISOString()
for (const [city, cs] of byCity) {
  const venues: Record<string, { photos: Photo[] }> = {}
  const sc = (stats.byCity[city] = { n: 0, ge1: 0, ge3: 0 })
  for (const c of cs) {
    const photos = pick(candidates(c, !NO_GEO)).map(({ score: _s, ...p }) => p as Photo)
    venues[c.id] = { photos }
    stats.venues++
    sc.n++
    if (photos.length >= 1) { stats.ge1++; sc.ge1++ }
    if (photos.length >= 3) { stats.ge3++; sc.ge3++ }
    for (const s of new Set(photos.map((p) => p.source))) stats.bySourceVenues[s]!++
  }
  writeAtomic(join(OUT_DIR, city + '.json'), JSON.stringify({ city, generatedAt, venues }, null, 1) + '\n')
}
const runtimeS = Math.round((Date.now() - t0) / 1000)
writeAtomic(join(CACHE, 'stats.json'), JSON.stringify({ ...stats, runtimeS, requests }, null, 1))
console.log(JSON.stringify({ venues: stats.venues, ge1: stats.ge1, ge3: stats.ge3, bySource: stats.bySourceVenues, runtimeS, requests }))
