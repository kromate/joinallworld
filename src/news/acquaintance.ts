/**
 * OWNER: news (docs/OPEN-SOURCE-PLAN.md, Phase 4)
 * PEOPLE WHO REMEMBER YOU, kept on this device only: which regular you said hello to or bought a drink for, for one day. Nothing goes to the
 * server and nothing is a record of a person: an entry is a regular's id (a character of the game, not a player), a kind and the time it
 * runs out. It is written where the NPC card starts an interaction (NpcCard.vue) and read by the ambient layer (src/scene/ambient/layer.ts),
 * which gives that regular a wave and one line when the player walks up (memory-lines.ts).
 *
 * localStorage key `joinallworld-acquaintance-v1`: `{ v: 1, people: { <npcId>: { kind, until } } }`. At most 50 entries (the ones that run out
 * last are kept); an entry that is malformed or has run out is skipped on every read. A browser that refuses storage simply remembers nothing.
 */

export const ACQUAINTANCE_KEY = 'joinallworld-acquaintance-v1'
/** How long a regular remembers. */
export const TTL_MS = 24 * 3600000
/** The most people kept. */
export const CAP = 50
export type Kind = 'greeted' | 'bought'
const KINDS: readonly Kind[] = ['greeted', 'bought']
type Store = Pick<Storage, 'getItem' | 'setItem'>
export interface Memory { kind: Kind; until: number }

const isKind = (value: unknown): value is Kind => typeof value === 'string' && (KINDS as readonly string[]).includes(value)
const defaultStore = (): Store | null => { try { return globalThis.localStorage ?? null } catch { return null } }

/** The people still remembered, by id. Anything malformed or past its time is left out; a store that cannot be read gives nobody. */
export function readAcquaintances(now: number, store: Store | null = defaultStore()): Map<string, Memory> {
  const found = new Map<string, Memory>()
  let raw: string | null = null
  try { raw = store?.getItem(ACQUAINTANCE_KEY) ?? null } catch { return found }
  if (!raw) return found
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return found }
  const people = typeof parsed === 'object' && parsed !== null && (parsed as { v?: unknown }).v === 1 ? (parsed as { people?: unknown }).people : null
  if (typeof people !== 'object' || people === null || Array.isArray(people)) return found
  for (const [id, entry] of Object.entries(people)) {
    if (!id || id.length > 80 || typeof entry !== 'object' || entry === null) continue
    const { kind, until } = entry as { kind?: unknown; until?: unknown }
    // An `until` further off than the TTL cannot have been written by this code: it is skipped like any other bad value.
    if (!isKind(kind) || typeof until !== 'number' || !Number.isFinite(until) || until <= now || until > now + TTL_MS) continue
    found.set(id, { kind, until })
  }
  return found
}

/** Remember a regular for a day. A drink bought outranks a hello, so a later hello does not take the memory back to a smaller one. */
export function remember(npcId: string, kind: Kind, now: number = Date.now(), store: Store | null = defaultStore()): void {
  if (!npcId || npcId.length > 80 || !isKind(kind) || !store) return
  const people = readAcquaintances(now, store)
  const before = people.get(npcId)
  people.set(npcId, { kind: before?.kind === 'bought' ? 'bought' : kind, until: now + TTL_MS })
  // Over the cap, the ones that would run out first are the first to go.
  const kept = [...people].sort((a, b) => b[1].until - a[1].until).slice(0, CAP)
  try { store.setItem(ACQUAINTANCE_KEY, JSON.stringify({ v: 1, people: Object.fromEntries(kept) })) } catch { /* private mode or full: nothing is remembered */ }
}

/** The kind of memory a regular holds of the player now, or null. */
export const recall = (npcId: string, now: number = Date.now(), store: Store | null = defaultStore()): Kind | null => readAcquaintances(now, store).get(npcId)?.kind ?? null

/** The NPC card's interaction ids that count: a hello, a gist, a joke or a compliment is being greeted; the drink is being bought for. */
export function kindOfAction(actionId: string): Kind | null {
  if (actionId === 'drink') return 'bought'
  return actionId === 'hello' || actionId === 'gist' || actionId === 'joke' || actionId === 'compliment' ? 'greeted' : null
}
