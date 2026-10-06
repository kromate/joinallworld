// Child process of reload.test.ts: only one city's content is loaded, as in a freshly opened page, and a saved life is read.
import { readFileSync } from 'node:fs'
import { createLife, viewLife } from '../src/life.ts'
import { cachedCityContent, cityRules } from '../src/game/cities/registry.ts'
import { lifeCities, loadLifeCities } from '../src/game/cities/lifeCities.ts'

const [file, city, trusted] = process.argv.slice(2)
if (!file || !city) throw new Error('usage: reload-probe <saved.json> <city> [trusted]')
const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
const referenced = lifeCities(saved, [city])
await loadLifeCities(saved, [city])
const now = Number(JSON.parse(readFileSync(file, 'utf8')).t) || Date.now()
const state = createLife(saved, { cityId: city, now, trustedSave: trusted === 'trusted' })
viewLife(state, { cityId: city, now })
process.stdout.write(JSON.stringify({
  city: state.estate.city,
  away: Object.keys(state.estate.away),
  job: state.job,
  visited: state.travel.visited.length,
  rules: referenced.every((id) => cityRules(id) !== null),
  cold: referenced.filter((id) => id !== city && cachedCityContent(id) === null),
}))
