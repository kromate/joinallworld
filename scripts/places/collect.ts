// Reads the scene-factory briefs and emits data/venues.json (every non-home venue, 1 row each).
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BRIEFS_DIR, VENUES_JSON, readJson, writeAtomic, type Venue } from './lib.ts'

const rows: Venue[] = []
const perDisp: Record<string, number> = {}
let nullPos = 0
let placeholders = 0
const files = readdirSync(BRIEFS_DIR).filter((f) => f.endsWith('.json')).sort()
for (const f of files) {
  const b = readJson(join(BRIEFS_DIR, f))
  const city: string = b.city.id
  for (const v of b.venues) {
    const disp: string = v.scene?.disposition
    if (disp === 'exclude-home') continue
    if (disp !== 'target-recipe' && disp !== 'preserve-authored') throw new Error(`unknown disposition ${disp} in ${f}`)
    const pos = v.position
    const hasLL = pos?.kind === 'lon-lat'
    const placeholder = /\(game venue\)/.test(v.name)
    rows.push({
      city,
      cityName: b.city.name,
      venueId: v.id,
      name: v.name,
      kind: v.kind,
      variant: v.scene?.variant ?? null,
      disposition: disp,
      lon: hasLL ? pos.lon : null,
      lat: hasLL ? pos.lat : null,
      placeholder,
      country: b.city.country?.name ?? null,
      countryId: b.city.country?.id ?? null,
      region: b.city.state?.name ?? null,
      styleRegion: b.style?.region ?? null,
    })
    perDisp[disp] = (perDisp[disp] ?? 0) + 1
    if (!hasLL) nullPos++
    if (placeholder) placeholders++
  }
}
writeAtomic(VENUES_JSON, JSON.stringify(rows, null, 0).replace(/\},\{/g, '},\n{') + '\n')
console.log(`cities=${files.length} rows=${rows.length}`, perDisp, `nullPosition=${nullPos} placeholders=${placeholders}`)
