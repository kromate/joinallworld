/** Discover every city reference in a saved life and load its full rules before reconstruction. */
import { isCityId, isKnownCityId, loadCityContent, loadCityLinks, loadCityRules, registeredCityIds } from './registry.ts'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const MAX_RELATIONSHIPS = 200
const MAX_VISITED_VENUES = 512
const MAX_ACTIVITY_COOLDOWNS = 80
const MAX_MISSION_VISITS = 64
const MAX_EVENT_ATTENDANCE = 24

/** Every registered city mentioned by the bounded fields that a saved life can preserve. */
export function lifeCities(raw: unknown, extra: readonly unknown[] = []): string[] {
  const found = new Set<string>()
  const add = (value: unknown): void => { if (typeof value === 'string' && isCityId(value)) found.add(value) }
  const addKnown = (value: unknown): void => { if (typeof value === 'string' && isKnownCityId(value)) found.add(value) }
  const addQualified = (value: unknown): void => {
    if (typeof value !== 'string') return
    add(value)
    const separator = value.indexOf(':')
    if (separator > 0) add(value.slice(0, separator))
  }

  const state = record(raw) ? raw : {}
  const estate = record(state.estate) ? state.estate : {}
  add(estate.city)
  add(estate.home)
  if (record(state.activeAction) && state.activeAction.kind === 'homeward' && record(state.activeAction.ticket)) {
    const ticket = state.activeAction.ticket
    addKnown(ticket.from)
    addKnown(ticket.to)
    if (Array.isArray(ticket.legs)) for (const leg of ticket.legs.slice(0, 4)) {
      if (record(leg)) { addKnown(leg.from); addKnown(leg.to) }
    }
  }
  for (const value of extra) add(value)
  if (record(estate.away)) for (const id of registeredCityIds()) if (Object.hasOwn(estate.away, id)) add(id)
  if (record(state.career)) add(state.career.city)
  if (record(state.activeAction) && state.activeAction.kind === 'intercity') { add(state.activeAction.from); add(state.activeAction.id) }
  if (record(state.social) && record(state.social.rel)) {
    for (const rel of Object.values(state.social.rel).slice(0, MAX_RELATIONSHIPS)) if (record(rel) && record(rel.npcSnapshot)) add(rel.npcSnapshot.city)
  }
  if (record(state.civic) && record(state.civic.hunt)) add(state.civic.hunt.city)
  if (record(state.travel)) {
    if (Array.isArray(state.travel.visited)) for (const key of state.travel.visited.slice(0, MAX_VISITED_VENUES)) addQualified(key)
    if (record(state.travel.cooldowns)) for (const key of Object.keys(state.travel.cooldowns).slice(0, MAX_ACTIVITY_COOLDOWNS)) addQualified(key)
  }
  if (record(state.missions) && record(state.missions.visited) && Array.isArray(state.missions.visited.list)) {
    for (const key of state.missions.visited.list.slice(0, MAX_MISSION_VISITS)) addQualified(key)
  }
  if (record(state.events) && Array.isArray(state.events.attended)) {
    for (const key of state.events.attended.slice(0, MAX_EVENT_ATTENDANCE)) addQualified(key)
  }
  return [...found]
}

/**
 * Load every referenced city's full rules, the shared authored routes, and the current city's content. A failure rejects;
 * callers must retain the saved value and avoid rebuilding it with partial rules.
 */
export async function loadLifeCities(raw: unknown, extra: readonly unknown[] = []): Promise<string[]> {
  const cities = lifeCities(raw, extra)
  await Promise.all([loadCityLinks(), ...cities.map(loadCityRules)])
  const state = record(raw) ? raw : {}
  const estate = record(state.estate) ? state.estate : {}
  const current = typeof estate.city === 'string' && isCityId(estate.city)
    ? estate.city
    : extra.find((value): value is string => typeof value === 'string' && isCityId(value))
  if (current) await loadCityContent(current)
  const active = record(state.activeAction) ? state.activeAction : {}
  const ticket = record(active.ticket) ? active.ticket : {}
  if (active.kind === 'homeward' && typeof ticket.to === 'string' && isKnownCityId(ticket.to)) await loadCityContent(ticket.to)
  return []
}
