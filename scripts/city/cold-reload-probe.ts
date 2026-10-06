import { readFileSync } from 'node:fs'
import { createLife, viewLife } from '../../src/life.ts'
import { cachedCityContent, cityRules, registeredCityIds } from '../../src/game/cities/registry.ts'
import { lifeCities, loadLifeCities } from '../../src/game/cities/lifeCities.ts'

const [file, city] = process.argv.slice(2)
if (!file || !city) throw new Error('usage: cold-reload-probe <saved.json> <city>')

const saved: unknown = JSON.parse(readFileSync(file, 'utf8'))
const referenced = lifeCities(saved, [city])
await loadLifeCities(saved, [city])
const stamp = typeof saved === 'object' && saved !== null ? Reflect.get(saved, 't') : undefined
const now = typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : Date.now()
const state = createLife(saved, { cityId: city, now, trustedSave: true })
viewLife(state, { cityId: city, now })

process.stdout.write(JSON.stringify({
  state,
  city: state.estate.city,
  away: Object.keys(state.estate.away).sort(),
  rules: referenced.every((id) => cityRules(id) !== null),
  content: registeredCityIds().filter((id) => cachedCityContent(id) !== null),
}))
