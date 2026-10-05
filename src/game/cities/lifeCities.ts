/**
 * Which cities a saved life refers to, and loading their content before the life is rebuilt.
 *
 * A life that has homes in two cities carries the second one under `estate.away`, and a worker, a friend or a
 * visited place can belong to a city other than the current one. The engine reads the CURRENT city's content
 * strictly; for every other city it only looks at what has been loaded. Every host therefore calls
 * `loadLifeCities(raw)` before it rebuilds or accepts a life, so that all of them are available.
 */
import { isCityId, loadCityContent } from './registry.ts'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const MAX_KEYS = 64

/** Every registered city the life refers to (the current one first). Ids that name no registered city are left out. */
export function lifeCities(raw: unknown, extra: readonly unknown[] = []): string[] {
  const found = new Set<string>()
  const add = (value: unknown): void => { if (typeof value === 'string' && isCityId(value)) found.add(value) }
  const addKey = (value: unknown, parts: number): void => {
    if (typeof value !== 'string') return
    const bits = value.split(':')
    if (bits.length === parts) add(bits[0])
  }
  const state = record(raw) ? raw : {}
  const estate = record(state.estate) ? state.estate : {}
  add(estate.city)
  for (const value of extra) add(value)
  if (record(estate.away)) for (const id of Object.keys(estate.away).slice(0, MAX_KEYS)) add(id)
  if (record(state.career)) add(state.career.city)
  if (record(state.social) && record(state.social.rel)) {
    for (const rel of Object.values(state.social.rel).slice(0, 1024)) if (record(rel) && record(rel.npcSnapshot)) add(rel.npcSnapshot.city)
  }
  if (record(state.missions) && record(state.missions.visited) && Array.isArray(state.missions.visited.list)) {
    for (const key of state.missions.visited.list.slice(0, MAX_KEYS)) addKey(key, 2)
  }
  if (record(state.events) && Array.isArray(state.events.attended)) {
    for (const key of state.events.attended.slice(0, MAX_KEYS)) addKey(key, 3)
  }
  return [...found]
}

/**
 * Load the content of every city the life refers to. Resolves with the cities that could not be loaded; rejects
 * only when the life's own current city is one of them (the engine cannot rebuild it without that).
 */
export async function loadLifeCities(raw: unknown, extra: readonly unknown[] = []): Promise<string[]> {
  const cities = lifeCities(raw, extra)
  const results = await Promise.allSettled(cities.map(id => loadCityContent(id)))
  const failed = cities.filter((_, index) => results[index]?.status === 'rejected')
  const estate = record(raw) && record(raw.estate) ? raw.estate : {}
  if (typeof estate.city === 'string' && failed.includes(estate.city)) {
    const first = results.find(item => item.status === 'rejected')
    throw (first as PromiseRejectedResult | undefined)?.reason ?? new Error('City content could not be loaded')
  }
  return failed
}
