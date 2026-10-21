// Coverage report over data/facts/*.json. Usage: node --experimental-strip-types scripts/places/stats.ts
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { FACTS_DIR, readJson, loadVenues } from './lib.ts'

const venues = new Map(loadVenues().map((v) => [`${v.city}/${v.venueId}`, v]))
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) : '0.0') + '%'
type Row = { n: number; levels: number; height: number; roofShape: number; roofColour: number; roofMat: number; wallColour: number; wallMat: number; wd: number; style: number; architect: number; floors: number; anyOsmAttr: number }
const blank = (): Row => ({ n: 0, levels: 0, height: 0, roofShape: 0, roofColour: 0, roofMat: 0, wallColour: 0, wallMat: 0, wd: 0, style: 0, architect: 0, floors: 0, anyOsmAttr: 0 })
const byQ: Record<string, Row> = {}
const byCity: Record<string, { all: Row; matched: number; named: number; rich: number }> = {}
const all = blank()
let placeholders = 0
let files = 0
let wdDone = 0
for (const f of readdirSync(FACTS_DIR).filter((x) => x.endsWith('.json')).sort()) {
  const d = readJson(join(FACTS_DIR, f))
  files++
  if (d.wikidataDone) wdDone++
  const c = (byCity[d.city] ??= { all: blank(), matched: 0, named: 0, rich: 0 })
  for (const [vid, x] of Object.entries<any>(d.venues)) {
    const q: string = x.match.quality
    const t = x.osm?.tags ?? {}
    const w = x.wikidata
    const hit = (r: Row) => {
      r.n++
      if (t['building:levels']) r.levels++
      if (t.height) r.height++
      if (t['roof:shape']) r.roofShape++
      if (t['roof:colour']) r.roofColour++
      if (t['roof:material']) r.roofMat++
      if (t['building:colour']) r.wallColour++
      if (t['building:material']) r.wallMat++
      if (w) r.wd++
      if (w?.style?.length || t['building:architecture']) r.style++
      if (w?.architect?.length || t.architect) r.architect++
      if (w?.floors != null || t['building:levels']) r.floors++
      if (t['building:levels'] || t.height || t['roof:shape'] || t['roof:colour'] || t['building:colour'] || t['building:material'] || t['roof:material']) r.anyOsmAttr++
    }
    hit((byQ[q] ??= blank()))
    hit(all)
    hit(c.all)
    if (venues.get(`${d.city}/${vid}`)?.placeholder) placeholders++
    if (q !== 'none') c.matched++
    if (q === 'name') c.named++
    if (t['building:levels'] || t.height || t['roof:shape'] || t['roof:colour'] || t['building:colour'] || t['building:material'] || w) c.rich++
  }
}
console.log(`facts files=${files}, wikidata-done=${wdDone}, venues=${all.n}, placeholders=${placeholders}`)
const header = 'quality      n      levels  height  roofShp roofCol roofMat wallCol wallMat  wikidata  style  architect floors  anyOSMattr'
console.log(header)
for (const [q, r] of [...Object.entries(byQ), ['ALL', all] as [string, Row]]) {
  console.log(
    [q.padEnd(11), String(r.n).padStart(5), ...[r.levels, r.height, r.roofShape, r.roofColour, r.roofMat, r.wallColour, r.wallMat, r.wd, r.style, r.architect, r.floors, r.anyOsmAttr].map((x) => pct(x, r.n).padStart(8))].join(' '),
  )
}
const cities = Object.entries(byCity).map(([c, v]) => ({ c, n: v.all.n, matched: v.matched / v.all.n, named: v.named, rich: v.rich / v.all.n }))
cities.sort((a, b) => b.matched - a.matched || b.rich - a.rich)
const show = (xs: typeof cities) => xs.map((x) => `${x.c}(${x.n}): matched ${(x.matched * 100).toFixed(0)}% named ${x.named} rich ${(x.rich * 100).toFixed(0)}%`).join('\n')
console.log('\nTOP 20 (matched share, then rich share)\n' + show(cities.slice(0, 20)))
console.log('\nWORST 20\n' + show(cities.slice(-20).reverse()))
