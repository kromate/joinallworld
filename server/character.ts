/** One active character and recoverable older lives, shared by both hosts. */
import { cityRules } from '../src/game/content/world.ts'
import { hasPlace } from '../src/game/systems/estate.ts'
import type { CityId } from '../src/types/protocol.ts'
import type { CityLifeRecord, SessionRecord } from './types.ts'

/** A pin this code wrote (version 2, or a recorded move). A bare `{v:1, city}` is the start-up pin of an older build, fixed at one moment and never updated. */
const isCurrentPin = (character: SessionRecord['character']): boolean => Boolean(character && (character.v === 2 || character.movedAt !== undefined))

/** The city of the life played most recently; ties go to the city with a house, then to Lagos. */
function newestLifeCity(session: SessionRecord): CityId | null {
  const entries = Object.entries(session.cities).filter((entry): entry is [CityId, CityLifeRecord] => Boolean(cityRules(entry[0]) && entry[1]?.state))
  const rank = (entry: [CityId, CityLifeRecord]): number => (hasPlace(entry[1].state) ? 2 : 0) + (entry[0] === 'lagos' ? 1 : 0)
  const latest = entries.reduce<[CityId, CityLifeRecord] | null>((best, entry) => {
    if (!best) return entry
    const a = entry[1].updatedAt ?? 0, b = best[1].updatedAt ?? 0
    return a > b || (a === b && rank(entry) > rank(best)) ? entry : best
  }, null)
  return latest?.[0] ?? null
}

/** The one place the active city is derived. Pure: normalizeCharacter writes the result down as a current pin. */
export function characterCity(session: SessionRecord): CityId | null {
  const explicit = session.character?.city
  if (isCurrentPin(session.character) && explicit && cityRules(explicit) && session.cities[explicit as CityId]) return explicit as CityId
  return newestLifeCity(session)
}

export function archiveLife(session: SessionRecord, city: string, entry: CityLifeRecord): string {
  const archive = session.legacyLives ??= {}
  let sequence = 1
  while (Object.hasOwn(archive, `${city}:${sequence}`)) sequence += 1
  const id = `${city}:${sequence}`
  archive[id] = entry
  const origins = session.legacyLifeCities ??= {}
  origins[id] = city
  return id
}

export function normalizeCharacter(session: SessionRecord): CityId | null {
  const active = characterCity(session)
  if (!active) return null
  for (const [city, entry] of Object.entries(session.cities)) {
    if (city !== active && entry) {
      archiveLife(session, city, entry)
      delete session.cities[city as CityId]
    }
  }
  session.character = { ...session.character, v: 2, city: active }
  return active
}

export function requireCharacterCity(session: SessionRecord, city: string): void {
  const active = characterCity(session)
  if (active && active !== city) throw Object.assign(new Error('city_moved'), {
    status: 409, code: 'city_moved', city: active,
    reason: `Your character is in ${cityRules(active)?.name ?? active}. Open that city to carry on.`,
  })
}

export function fileCharacter(session: SessionRecord, from: CityId, now: number): void {
  const entry = session.cities[from]
  if (!entry) return
  const to = entry.state.estate.city
  if (!cityRules(to)) throw new TypeError('Character has an unregistered city')
  if (to !== from) {
    const aside = session.cities[to as CityId]
    if (aside && aside !== entry) archiveLife(session, to, aside)
    session.cities[to as CityId] = entry
    delete session.cities[from]
    session.character = { v: 2, city: to, from, movedAt: now }
  } else session.character = { ...session.character, v: 2, city: to }
}

export function swapLegacyLife(session: SessionRecord, id: string): { ok: true; city: string } {
  const selected = session.legacyLives?.[id]
  if (!selected) throw Object.assign(new Error('unknown_legacy_life'), { status: 404, code: 'unknown_legacy_life' })
  const city = legacyLifeCity(session, id, selected)
  if (!cityRules(city)) throw Object.assign(new Error('invalid_city'), { status: 400, code: 'invalid_city' })
  const active = normalizeCharacter(session)
  const previous = active ? session.cities[active] : undefined
  if (previous?.state.activeAction) throw Object.assign(new Error('busy'), { status: 409, code: 'busy', reason: 'Finish your current action before switching characters.' })
  // Replace the selected archive slot with the active life. No record is merged or discarded.
  if (previous && active) { session.legacyLives![id] = previous; (session.legacyLifeCities ??= {})[id] = active }
  else { delete session.legacyLives![id]; if (session.legacyLifeCities) delete session.legacyLifeCities[id] }
  if (active) delete session.cities[active]
  session.cities[city as CityId] = selected
  session.character = { v: 2, city }
  return { ok: true, city }
}

export function legacyLifeCity(session: SessionRecord, id: string, entry: CityLifeRecord): string {
  const city = entry.state.estate?.city ?? session.legacyLifeCities?.[id] ?? id.split(':')[0]
  if (!city || !cityRules(city)) throw Object.assign(new Error('invalid_city'), { status: 400, code: 'invalid_city' })
  return city
}
